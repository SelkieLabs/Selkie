//! Selkie pocket (NEAR): a small, capped amount of USDC a user parks so a tweet
//! like "@SelkiePay send 2 to @amaka" can pay without a signature at tweet time.
//!
//! The owner tops a pocket up with `ft_transfer_call` (msg `{"kind":"top_up"}`)
//! and can withdraw or change the daily cap at any time. The bot, Selkie's X
//! bot account, signs `pocket_send` with a function-call key that can call
//! nothing else, and this contract holds it to three rules:
//!
//!  - it only spends from a pocket, never from anyone's account;
//!  - at most the owner's daily cap per UTC day;
//!  - only to Selkie handle accounts: direct children of `handle_parent`
//!    (`amaka.x.selkiepay.testnet`), which only exist for people who proved an
//!    X login.
//!
//! So a stolen bot key can, at worst, pay real Selkie users up to each pocket's
//! daily cap. It cannot withdraw, raise a cap, or pay an address of its choice.
//!
//! Recipients not on Selkie yet are not paid from here: the handle escrow
//! refunds an unclaimed payment to its sender, which would be this contract,
//! with no record of whose pocket it came from. They keep the web flow.
//!
//! Like the handle escrow, every payout takes the money out of the pocket
//! *first*, sends, and puts it back in a callback only if the transfer failed.
//!
//! Roles:
//!  - owner (admin): rotates the bot. Never touches a pocket.
//!  - bot: `pocket_send` only.
//!  - pocket owner: anyone who topped up. Withdraws and sets their own cap.
//!
//! Storage: the contract pays for pocket records from its own NEAR balance and
//! refuses (refunds) a top-up that would create a new pocket once its spare
//! balance falls below `STORAGE_RESERVE`.

use near_sdk::json_types::U128;
use near_sdk::serde::Deserialize;
use near_sdk::store::LookupMap;
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
    assert_one_yocto, env, ext_contract, near, require, serde_json,
};

mod events;
#[cfg(test)]
mod tests;

use events::{CapData, SendData, TopUpData, WithdrawData, emit};

/// Daily cap of a pocket topped up without one: 10 USDC (6 decimals).
pub const DEFAULT_DAILY_CAP: u128 = 10_000_000;
/// Gas for the token's `ft_transfer`. NEP-141 transfers use well under 10 Tgas.
pub const FT_TRANSFER_GAS: Gas = Gas::from_tgas(15);
/// Gas reserved for the callback that restores a pocket after a failed transfer.
pub const CALLBACK_GAS: Gas = Gas::from_tgas(15);
/// NEAR kept free so new pockets cannot eat the balance the contract runs on.
pub const STORAGE_RESERVE: NearToken = NearToken::from_millinear(500);

const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
/// A cap day is a UTC day: block time divided by this.
pub const NS_PER_DAY: u64 = 86_400_000_000_000;

/// Prefixes for the persistent collections. Append only.
#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Pockets,
}

/// One owner's pocket. `spent` counts what the bot sent on `day`.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Pocket {
    pub balance: u128,
    pub daily_cap: u128,
    pub spent: u128,
    pub day: u64,
}

impl Pocket {
    /// What has been spent on `today`: nothing if the last send was earlier.
    fn spent_on(&self, today: u64) -> u128 {
        if self.day == today { self.spent } else { 0 }
    }
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PocketView {
    pub balance: U128,
    pub daily_cap: U128,
    pub spent_today: U128,
    /// The smaller of the balance and what is left of today's cap.
    pub left_today: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct ConfigView {
    pub owner: AccountId,
    pub bot: AccountId,
    pub token: AccountId,
    pub handle_parent: AccountId,
}

/// The `msg` of a top-up. Anything else is refunded in full.
#[derive(Deserialize)]
#[serde(
    crate = "near_sdk::serde",
    tag = "kind",
    rename_all = "snake_case",
    deny_unknown_fields
)]
enum TransferMsg {
    TopUp {
        #[serde(default)]
        daily_cap: Option<U128>,
    },
}

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct SelkiePocket {
    owner: AccountId,
    bot: AccountId,
    /// The one token pockets hold (USDC).
    token: AccountId,
    /// The bot may pay direct children of this account and nothing else.
    handle_parent: AccountId,
    pockets: LookupMap<AccountId, Pocket>,
}

#[near]
impl SelkiePocket {
    /// `#[private]`: only the contract account can initialise, so nobody can
    /// front-run the deploy and name their own bot.
    #[init]
    #[private]
    pub fn new(
        owner: AccountId,
        bot: AccountId,
        token: AccountId,
        handle_parent: AccountId,
    ) -> Self {
        Self {
            owner,
            bot,
            token,
            handle_parent,
            pockets: LookupMap::new(StorageKey::Pockets),
        }
    }

    // ---- money in -------------------------------------------------------

    /// NEP-141 receiver hook. Credits `sender_id`'s pocket and returns 0, or
    /// returns the full amount (the token refunds it) when the msg is not a
    /// top-up. Panics for any token but ours: only the token contract vouches
    /// for `sender_id` and `amount`, and anyone can call this method.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        require!(
            env::predecessor_account_id() == self.token,
            "only the pocket's token can top up"
        );
        let daily_cap = match serde_json::from_str::<TransferMsg>(&msg) {
            Ok(TransferMsg::TopUp { daily_cap }) => daily_cap.map(|cap| cap.0),
            Err(_) => return refuse(amount, "msg is not a top_up"),
        };
        if amount.0 == 0 {
            return refuse(amount, "nothing to top up");
        }

        let mut pocket = match self.pockets.get(&sender_id) {
            Some(pocket) => pocket.clone(),
            None => {
                if spare_balance() < STORAGE_RESERVE {
                    return refuse(amount, "the pocket contract needs more NEAR for storage");
                }
                Pocket {
                    balance: 0,
                    daily_cap: DEFAULT_DAILY_CAP,
                    spent: 0,
                    day: today(),
                }
            }
        };
        let Some(balance) = pocket.balance.checked_add(amount.0) else {
            return refuse(amount, "balance would overflow");
        };
        pocket.balance = balance;
        if let Some(cap) = daily_cap {
            pocket.daily_cap = cap;
        }
        emit(
            "top_up",
            &[TopUpData {
                owner: &sender_id,
                amount,
                balance: U128(pocket.balance),
                daily_cap: U128(pocket.daily_cap),
            }],
        );
        self.pockets.insert(sender_id, pocket);
        U128(0)
    }

    // ---- money out: the bot ----------------------------------------------

    /// Pay `amount` from `owner`'s pocket to the handle account `to`. Bot only.
    /// Resolves to `true` when paid, `false` when the transfer failed and the
    /// pocket was restored.
    ///
    /// Not payable: the bot signs with a function-call key, which cannot attach
    /// a deposit. The 1 yoctoNEAR `ft_transfer` needs comes from this contract.
    pub fn pocket_send(
        &mut self,
        owner: AccountId,
        to: AccountId,
        amount: U128,
        memo: Option<String>,
    ) -> Promise {
        require!(
            env::predecessor_account_id() == self.bot,
            "only the bot can send from a pocket"
        );
        require!(
            self.is_handle_account(&to),
            "can only send to a Selkie handle account"
        );
        require!(to != owner, "cannot send a pocket to its owner");
        require!(amount.0 > 0, "amount must be more than zero");

        let mut pocket = self.pocket_of(&owner);
        let day = today();
        if pocket.day != day {
            pocket.day = day;
            pocket.spent = 0;
        }
        require!(amount.0 <= pocket.balance, "not enough in the pocket");
        let spent = pocket
            .spent
            .checked_add(amount.0)
            .filter(|spent| *spent <= pocket.daily_cap)
            .unwrap_or_else(|| env::panic_str("over the pocket's daily cap"));
        require_gas(FT_TRANSFER_GAS.saturating_add(CALLBACK_GAS));

        // Take the money out before the transfer leaves (see the module docs).
        pocket.balance -= amount.0;
        pocket.spent = spent;
        self.pockets.insert(owner.clone(), pocket);

        let memo = memo.or_else(|| Some("Selkie pocket".to_string()));
        let callback = Self::ext(env::current_account_id())
            .with_static_gas(CALLBACK_GAS)
            .with_unused_gas_weight(1)
            .on_send_resolved(owner, to.clone(), amount, day);
        ft_transfer(self.token.clone(), to, amount.0, memo).then(callback)
    }

    /// Runs after a send's transfer. On failure, puts the money back in the
    /// pocket, and takes it off today's spend if the day has not rolled over
    /// since. Must not panic.
    #[private]
    pub fn on_send_resolved(
        &mut self,
        owner: AccountId,
        to: AccountId,
        amount: U128,
        day: u64,
    ) -> bool {
        let data = [SendData {
            owner: &owner,
            to: &to,
            amount,
        }];
        if transfer_succeeded() {
            emit("send", &data);
            return true;
        }
        emit("send_failed", &data);
        if let Some(pocket) = self.pockets.get_mut(&owner) {
            pocket.balance = pocket.balance.saturating_add(amount.0);
            if pocket.day == day {
                pocket.spent = pocket.spent.saturating_sub(amount.0);
            }
        }
        false
    }

    // ---- money out: the owner --------------------------------------------

    /// Take `amount` (everything when `None`) out of the caller's pocket, back
    /// to their account. Exactly 1 yoctoNEAR: only a full-access key, the
    /// owner's own, can attach it, so no function-call key can withdraw.
    #[payable]
    pub fn pocket_withdraw(&mut self, amount: Option<U128>) -> Promise {
        assert_one_yocto();
        let owner = env::predecessor_account_id();
        let mut pocket = self.pocket_of(&owner);
        let amount = match amount {
            Some(amount) => {
                require!(amount.0 > 0, "amount must be more than zero");
                amount.0
            }
            None => pocket.balance,
        };
        require!(amount > 0, "nothing to withdraw");
        require!(amount <= pocket.balance, "not enough in the pocket");
        require_gas(FT_TRANSFER_GAS.saturating_add(CALLBACK_GAS));

        pocket.balance -= amount;
        self.pockets.insert(owner.clone(), pocket);

        let callback = Self::ext(env::current_account_id())
            .with_static_gas(CALLBACK_GAS)
            .with_unused_gas_weight(1)
            .on_withdraw_resolved(owner.clone(), U128(amount));
        ft_transfer(
            self.token.clone(),
            owner,
            amount,
            Some("Selkie pocket withdraw".to_string()),
        )
        .then(callback)
    }

    /// Runs after a withdraw's transfer; puts the money back if it failed.
    #[private]
    pub fn on_withdraw_resolved(&mut self, owner: AccountId, amount: U128) -> bool {
        let data = [WithdrawData {
            owner: &owner,
            amount,
        }];
        if transfer_succeeded() {
            emit("withdraw", &data);
            return true;
        }
        emit("withdraw_failed", &data);
        if let Some(pocket) = self.pockets.get_mut(&owner) {
            pocket.balance = pocket.balance.saturating_add(amount.0);
        }
        false
    }

    /// Change the caller's daily cap. 0 stops the bot spending from it. Takes
    /// effect at once, including for today. Exactly 1 yoctoNEAR.
    #[payable]
    pub fn pocket_set_cap(&mut self, daily_cap: U128) {
        assert_one_yocto();
        let owner = env::predecessor_account_id();
        let mut pocket = self.pocket_of(&owner);
        pocket.daily_cap = daily_cap.0;
        self.pockets.insert(owner.clone(), pocket);
        emit(
            "cap",
            &[CapData {
                owner: &owner,
                daily_cap,
            }],
        );
    }

    // ---- views -----------------------------------------------------------

    pub fn get_pocket(&self, owner: AccountId) -> Option<PocketView> {
        let pocket = self.pockets.get(&owner)?;
        let spent_today = pocket.spent_on(today());
        let left_today = pocket
            .balance
            .min(pocket.daily_cap.saturating_sub(spent_today));
        Some(PocketView {
            balance: U128(pocket.balance),
            daily_cap: U128(pocket.daily_cap),
            spent_today: U128(spent_today),
            left_today: U128(left_today),
        })
    }

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            owner: self.owner.clone(),
            bot: self.bot.clone(),
            token: self.token.clone(),
            handle_parent: self.handle_parent.clone(),
        }
    }

    // ---- admin -----------------------------------------------------------

    /// Rotate the bot account. Owner only, exactly 1 yoctoNEAR.
    #[payable]
    pub fn set_bot(&mut self, bot: AccountId) {
        require!(
            env::predecessor_account_id() == self.owner,
            "only the owner can do this"
        );
        assert_one_yocto();
        env::log_str(&format!("bot changed from {} to {bot}", self.bot));
        self.bot = bot;
    }
}

// ---- internals -------------------------------------------------------------

impl SelkiePocket {
    fn pocket_of(&self, owner: &AccountId) -> Pocket {
        self.pockets
            .get(owner)
            .cloned()
            .unwrap_or_else(|| env::panic_str("no pocket for this account"))
    }

    /// `<label>.<handle_parent>` with no dot in the label. AccountId parsing
    /// already guarantees the label is a valid account-id part.
    fn is_handle_account(&self, account: &AccountId) -> bool {
        account
            .as_str()
            .strip_suffix(self.handle_parent.as_str())
            .and_then(|rest| rest.strip_suffix('.'))
            .is_some_and(|label| !label.is_empty() && !label.contains('.'))
    }
}

fn today() -> u64 {
    env::block_timestamp() / NS_PER_DAY
}

/// Decline a transfer: returning the full amount makes the token refund it.
fn refuse(amount: U128, why: &str) -> U128 {
    env::log_str(&format!("refunding {}: {why}", amount.0));
    amount
}

fn ft_transfer(
    token: AccountId,
    receiver_id: AccountId,
    amount: u128,
    memo: Option<String>,
) -> Promise {
    // NEP-141 demands exactly 1 yoctoNEAR on ft_transfer. Weight 0: leftover
    // gas goes to the callback, the step that must not run dry.
    ext_ft::ext(token)
        .with_attached_deposit(ONE_YOCTO)
        .with_static_gas(FT_TRANSFER_GAS)
        .with_unused_gas_weight(0)
        .ft_transfer(receiver_id, U128(amount), memo)
}

/// Fail early, with a readable message, when too little gas is attached for
/// the transfer and a callback that can undo it.
fn require_gas(needed: Gas) {
    let left = env::prepaid_gas().saturating_sub(env::used_gas());
    if left < needed {
        env::panic_str(&format!(
            "not enough gas: this call needs at least {} Tgas more; attach 100 Tgas",
            needed.as_tgas()
        ));
    }
}

/// Whether the one transfer this callback follows succeeded. Reads 0 bytes of
/// its result: `ft_transfer` returns nothing, and any payload still means it ran.
fn transfer_succeeded() -> bool {
    !matches!(env::promise_result_checked(0, 0), Err(PromiseError::Failed))
}

/// NEAR this account holds beyond what its current storage locks up.
fn spare_balance() -> NearToken {
    let locked = env::storage_byte_cost().saturating_mul(u128::from(env::storage_usage()));
    env::account_balance().saturating_sub(locked)
}
