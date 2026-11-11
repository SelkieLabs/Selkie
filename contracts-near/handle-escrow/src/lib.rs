//! Selkie handle escrow (NEAR): pay an X account that has no wallet yet.
//!
//! A sender moves USDC here with `ft_transfer_call`, naming a *recipient key*:
//! sha256 of an X identity as 64 lowercase hex chars, never the handle itself.
//! The money waits in this contract, not in any company wallet, until either
//!
//!  - the handle's owner signs in to Selkie, the oracle attests that login and
//!    calls `claim`, which pays everything waiting for that key to the NEAR
//!    account just created for them; or
//!  - the payment expires unclaimed and its sender calls `refund`.
//!
//! Roles:
//!  - owner:  rotates the oracle and edits the token allowlist. It never touches
//!    a payment itself, but whoever it names as oracle can, so treat the owner
//!    key as being as sensitive as the oracle's.
//!  - oracle: Selkie's backend. Its only power is paying a recipient key's
//!    payments to an account after a proven login.
//!  - sender: can take back their own payment once it has expired. Expiry only
//!    opens the refund door; it does not close the claim door.
//!
//! On NEAR a token transfer is a separate receipt that may fail after this
//! contract has finished. So every payout deletes its records *first*, sends,
//! and puts the records back in a callback only if the transfer failed. While a
//! transfer is in flight its payments are simply absent, which is what makes a
//! second claim, or a refund racing a claim, find nothing to pay.
//!
//! Storage: the contract pays for its own records out of its NEAR balance
//! (roughly 0.003 NEAR per pending payment, released again when it is claimed
//! or refunded), so a sender never attaches NEAR and a payment is a single
//! `ft_transfer_call`. New holds are refused, and refunded, once the spare
//! balance falls below `STORAGE_RESERVE`: that NEAR stays free so a failed
//! transfer's callback can always afford to write its payments back. Fund the
//! account with enough for the code plus a few NEAR.

use near_sdk::json_types::{U64, U128};
use near_sdk::store::{IterableSet, LookupMap};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
    PromiseOrValue, assert_one_yocto, env, ext_contract, near, require,
};
use std::collections::BTreeMap;

mod events;
mod msg;
#[cfg(test)]
mod tests;

use events::{ClaimData, RefundData, emit};
pub use msg::MAX_HOLD_ITEMS;

/// Gas for the token's `ft_transfer`. NEP-141 transfers use well under 10 Tgas.
pub const FT_TRANSFER_GAS: Gas = Gas::from_tgas(15);
/// Fixed gas for a payout callback, on top of `RESTORE_GAS_PER_PAYMENT`.
pub const CALLBACK_GAS: Gas = Gas::from_tgas(15);
/// Extra callback gas per payment it may have to write back. Reserved up
/// front, so a claim either has the gas to undo itself or does not start.
pub const RESTORE_GAS_PER_PAYMENT: Gas = Gas::from_tgas(1);
/// Most payments one `claim` releases. A recipient key can be sent any number
/// of dust payments by anyone; without a cap, enough of them would make the
/// claim exceed the gas limit and lock the real ones in. The oracle calls
/// `claim` again while it keeps returning this many.
pub const MAX_CLAIM_BATCH: usize = 50;
/// NEAR kept free for callbacks that restore payments (see the module docs).
pub const STORAGE_RESERVE: NearToken = NearToken::from_millinear(500);

const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const NS_PER_SEC: u64 = 1_000_000_000;
/// Storage key prefix for each token's smallest payment (see `min_hold`).
const MIN_HOLD_PREFIX: &[u8] = b"min_hold:";

/// Prefixes for the persistent collections. Append only: reordering or
/// deleting a variant would point a deployed contract at the wrong data.
#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Tokens,
    Payments,
    ByRecipient,
}

/// One payment waiting for its recipient.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Payment {
    pub sender: AccountId,
    pub token: AccountId,
    pub amount: U128,
    /// The recipient key (sha256 of the X identity, 64 lowercase hex chars).
    pub recipient: String,
    /// Block time (ns) from which the sender may refund.
    pub expiry_ns: u64,
}

/// What views and the `hold` event show for a payment.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PaymentView {
    pub id: U64,
    pub sender: AccountId,
    pub token: AccountId,
    pub amount: U128,
    pub recipient: String,
    pub expiry_ns: U64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct ConfigView {
    pub owner: AccountId,
    pub oracle: AccountId,
    pub tokens: Vec<AccountId>,
    pub max_lifetime_secs: u64,
    /// Smallest payment held, per allowed token, in its base units.
    pub min_hold: BTreeMap<AccountId, U128>,
}

/// The payments of one token taken out by a claim, carried to the callback so
/// it can put them back if their transfer failed.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct ClaimGroup {
    pub token: AccountId,
    pub payments: Vec<(u64, Payment)>,
}

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct HandleEscrow {
    owner: AccountId,
    oracle: AccountId,
    /// Tokens this contract will hold. Anything else is refunded on arrival.
    tokens: IterableSet<AccountId>,
    max_lifetime_secs: u64,
    next_id: u64,
    payments: LookupMap<u64, Payment>,
    /// recipient key -> ids of its pending payments, oldest first.
    by_recipient: LookupMap<String, Vec<u64>>,
}

#[near]
impl HandleEscrow {
    /// `#[private]`: only the contract account itself can initialise, so nobody
    /// can front-run the deploy and name their own oracle.
    #[init]
    #[private]
    pub fn new(
        owner: AccountId,
        oracle: AccountId,
        tokens: Vec<AccountId>,
        max_lifetime_secs: u64,
    ) -> Self {
        require!(
            max_lifetime_secs > 0 && max_lifetime_secs.checked_mul(NS_PER_SEC).is_some(),
            "max_lifetime_secs must be positive and fit in nanoseconds"
        );
        let mut set = IterableSet::new(StorageKey::Tokens);
        for token in tokens {
            set.insert(token);
        }
        Self {
            owner,
            oracle,
            tokens: set,
            max_lifetime_secs,
            next_id: 0,
            payments: LookupMap::new(StorageKey::Payments),
            by_recipient: LookupMap::new(StorageKey::ByRecipient),
        }
    }

    // ---- money in -------------------------------------------------------

    /// NEP-141 receiver hook: the token calls this during `ft_transfer_call`.
    /// Returns how much the token should send back to `sender_id`: 0 when the
    /// payments were created, the full amount when anything was wrong. A panic
    /// here also refunds in full (the token treats a failed call as unused),
    /// but returning keeps the reason readable in the logs.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        // The predecessor is the token contract, and only an allowlisted token
        // vouches for `sender_id` and `amount`. Anyone can call this method.
        let token = env::predecessor_account_id();
        if !self.tokens.contains(&token) {
            return refuse(amount, "not an allowed token");
        }
        let hold = match msg::parse(&msg, amount.0, self.max_lifetime_secs) {
            Ok(hold) => hold,
            Err(why) => return refuse(amount, why),
        };
        // Every payment costs this contract storage until it is claimed or
        // refunded. A floor makes filling it with dust cost the spammer real
        // money for as long as the dust sits here.
        let floor = min_hold(&token);
        if hold.items.iter().any(|(_, item)| *item < floor) {
            return refuse(amount, "a payment is below the minimum hold");
        }
        let Some(expiry_ns) = hold
            .lifetime_secs
            .checked_mul(NS_PER_SEC)
            .and_then(|ns| env::block_timestamp().checked_add(ns))
        else {
            return refuse(amount, "expiry does not fit in a timestamp");
        };
        if spare_balance() < STORAGE_RESERVE {
            return refuse(amount, "the escrow needs more NEAR for storage");
        }

        let mut created = Vec::with_capacity(hold.items.len());
        for (recipient, item_amount) in hold.items {
            let id = self.next_id;
            self.next_id = id
                .checked_add(1)
                .unwrap_or_else(|| env::panic_str("payment ids exhausted"));
            let payment = Payment {
                sender: sender_id.clone(),
                token: token.clone(),
                amount: U128(item_amount),
                recipient,
                expiry_ns,
            };
            self.index_add(&payment.recipient, id);
            created.push(view(id, &payment));
            self.payments.insert(id, payment);
        }
        emit("hold", &created);
        PromiseOrValue::Value(U128(0))
    }

    // ---- money out: claim ------------------------------------------------

    /// Pay up to `MAX_CLAIM_BATCH` of the recipient key's pending payments
    /// (oldest first) to `account_id`, one `ft_transfer` per token. Oracle only.
    /// Resolves to the number of payments released, or 0 if nothing was
    /// pending or every transfer failed (those payments are then pending again).
    ///
    /// Not payable: the oracle signs with a function-call key, which cannot
    /// attach a deposit. The 1 yoctoNEAR each `ft_transfer` needs comes from
    /// this contract's balance.
    pub fn claim(&mut self, recipient: String, account_id: AccountId) -> PromiseOrValue<u32> {
        require!(
            env::predecessor_account_id() == self.oracle,
            "only the oracle can claim"
        );

        let Some(mut ids) = self.by_recipient.remove(&recipient) else {
            return PromiseOrValue::Value(0);
        };
        if ids.len() > MAX_CLAIM_BATCH {
            let rest = ids.split_off(MAX_CLAIM_BATCH);
            self.by_recipient.insert(recipient.clone(), rest);
        }

        // Remove before paying. BTreeMap keeps the per-token order deterministic.
        let mut by_token: BTreeMap<AccountId, Vec<(u64, Payment)>> = BTreeMap::new();
        let mut count: u64 = 0;
        for id in ids {
            // The index never outlives its payment; skipping rather than
            // panicking keeps a recipient claimable even if that ever broke.
            if let Some(payment) = self.payments.remove(&id) {
                by_token
                    .entry(payment.token.clone())
                    .or_default()
                    .push((id, payment));
                count += 1;
            }
        }
        if by_token.is_empty() {
            return PromiseOrValue::Value(0);
        }

        let callback_gas = callback_gas(count);
        let needed = FT_TRANSFER_GAS
            .saturating_mul(by_token.len() as u64)
            .saturating_add(callback_gas);
        require_gas(needed);

        let memo = Some("Selkie claim".to_string());
        let mut transfers: Option<Promise> = None;
        let mut groups = Vec::with_capacity(by_token.len());
        for (token, payments) in by_token {
            let total =
                sum_amounts(&payments).unwrap_or_else(|| env::panic_str("claim total overflows"));
            let transfer = ft_transfer(token.clone(), account_id.clone(), total, memo.clone());
            transfers = Some(match transfers {
                None => transfer,
                Some(earlier) => earlier.and(transfer),
            });
            groups.push(ClaimGroup { token, payments });
        }
        let callback = Self::ext(env::current_account_id())
            .with_static_gas(callback_gas)
            .with_unused_gas_weight(1)
            .on_claim_resolved(recipient, account_id, groups);
        let transfers = transfers.unwrap_or_else(|| env::panic_str("claim built no transfer"));
        PromiseOrValue::Promise(transfers.then(callback))
    }

    /// Runs after every transfer of a claim. Puts back the payments of any
    /// token whose transfer failed (most often: `account_id` is not registered
    /// with that token yet) and returns how many were actually paid out. Must
    /// not panic: a panic here would leave failed payments deleted.
    #[private]
    pub fn on_claim_resolved(
        &mut self,
        recipient: String,
        account_id: AccountId,
        groups: Vec<ClaimGroup>,
    ) -> u32 {
        // Transfer i (joined in claim's order) belongs to groups[i].
        let succeeded: Vec<bool> = (0..groups.len())
            .map(|i| transfer_succeeded(i as u64))
            .collect();

        let mut released: u32 = 0;
        let mut paid = Vec::new();
        let mut restored = Vec::new();
        for (group, ok) in groups.iter().zip(&succeeded) {
            let data = ClaimData {
                recipient: &recipient,
                account_id: &account_id,
                token: &group.token,
                // Cannot overflow: claim summed the same payments with a check.
                amount: U128(sum_amounts(&group.payments).unwrap_or(u128::MAX)),
                ids: group.payments.iter().map(|(id, _)| U64(*id)).collect(),
            };
            if *ok {
                released = released.saturating_add(group.payments.len() as u32);
                paid.push(data);
            } else {
                restored.push(data);
            }
        }
        if !paid.is_empty() {
            emit("claim", &paid);
        }
        if !restored.is_empty() {
            emit("claim_failed", &restored);
        }

        for (group, ok) in groups.into_iter().zip(succeeded) {
            if !ok {
                for (id, payment) in group.payments {
                    self.restore(id, payment);
                }
            }
        }
        released
    }

    // ---- money out: refund -----------------------------------------------

    /// Send an expired payment back to its sender. Only the sender may ask,
    /// and only once `block_timestamp >= expiry_ns`. Not payable and needs no
    /// 1 yocto, so a relayer can submit it as a NEP-366 meta transaction; the
    /// money can only ever go back to the predecessor, so a leaked
    /// function-call key cannot redirect it. Resolves to `true` when refunded,
    /// `false` when the transfer failed and the payment is pending again.
    pub fn refund(&mut self, id: U64) -> Promise {
        let payment = self
            .payments
            .get(&id.0)
            .cloned()
            .unwrap_or_else(|| env::panic_str("no pending payment with this id"));
        require!(
            env::predecessor_account_id() == payment.sender,
            "only the sender can refund"
        );
        require!(
            env::block_timestamp() >= payment.expiry_ns,
            "this payment has not expired yet"
        );
        require_gas(FT_TRANSFER_GAS.saturating_add(callback_gas(1)));

        self.payments.remove(&id.0);
        self.index_remove(&payment.recipient, id.0);

        let transfer = ft_transfer(
            payment.token.clone(),
            payment.sender.clone(),
            payment.amount.0,
            Some("Selkie refund".to_string()),
        );
        let callback = Self::ext(env::current_account_id())
            .with_static_gas(callback_gas(1))
            .with_unused_gas_weight(1)
            .on_refund_resolved(id, payment);
        transfer.then(callback)
    }

    /// Runs after a refund's transfer; puts the payment back if it failed.
    #[private]
    pub fn on_refund_resolved(&mut self, id: U64, payment: Payment) -> bool {
        let data = [RefundData {
            id,
            sender: &payment.sender,
            token: &payment.token,
            amount: payment.amount,
        }];
        if transfer_succeeded(0) {
            emit("refund", &data);
            return true;
        }
        emit("refund_failed", &data);
        self.restore(id.0, payment);
        false
    }

    // ---- views -----------------------------------------------------------

    /// Payments waiting for a recipient key, oldest first. Payments inside an
    /// in-flight claim or refund are not listed until their callback runs.
    pub fn pending(&self, recipient: String) -> Vec<PaymentView> {
        let Some(ids) = self.by_recipient.get(&recipient) else {
            return Vec::new();
        };
        ids.iter()
            .filter_map(|id| self.payments.get(id).map(|p| view(*id, p)))
            .collect()
    }

    pub fn get_payment(&self, id: U64) -> Option<PaymentView> {
        self.payments.get(&id.0).map(|p| view(id.0, p))
    }

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            owner: self.owner.clone(),
            oracle: self.oracle.clone(),
            tokens: self.tokens.iter().cloned().collect(),
            max_lifetime_secs: self.max_lifetime_secs,
            min_hold: self
                .tokens
                .iter()
                .map(|token| (token.clone(), U128(min_hold(token))))
                .collect(),
        }
    }

    // ---- owner -----------------------------------------------------------
    //
    // Each owner method wants exactly 1 yoctoNEAR attached. Only a full-access
    // key can attach a deposit, so a function-call key the owner hands out (to
    // a wallet, a dapp) can never rotate the oracle or change what is held.

    /// Rotate the backend account that attests logins.
    #[payable]
    pub fn set_oracle(&mut self, oracle: AccountId) {
        self.assert_owner();
        env::log_str(&format!("oracle changed from {} to {oracle}", self.oracle));
        self.oracle = oracle;
    }

    #[payable]
    pub fn add_token(&mut self, token: AccountId) {
        self.assert_owner();
        self.tokens.insert(token);
    }

    /// Stops new holds in `token`. Payments already held in it stay claimable
    /// and refundable: payouts never consult the allowlist.
    #[payable]
    pub fn remove_token(&mut self, token: AccountId) {
        self.assert_owner();
        self.tokens.remove(&token);
    }

    /// The smallest single payment held in `token`, in its base units (USDC:
    /// 10000 = 0.01). Applies to new holds only; 0 turns the floor off.
    #[payable]
    pub fn set_min_hold(&mut self, token: AccountId, amount: U128) {
        self.assert_owner();
        env::log_str(&format!("min hold for {token} set to {}", amount.0));
        env::storage_write(&min_hold_key(&token), &amount.0.to_le_bytes());
    }
}

// ---- internals -------------------------------------------------------------

impl HandleEscrow {
    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner,
            "only the owner can do this"
        );
        assert_one_yocto();
    }

    /// Add `id` to a recipient's index, keeping it sorted and free of
    /// duplicates. New ids are always the largest, so this is a push; restored
    /// ids slot back into their original place.
    fn index_add(&mut self, recipient: &str, id: u64) {
        match self.by_recipient.get_mut(recipient) {
            Some(ids) => {
                if let Err(at) = ids.binary_search(&id) {
                    ids.insert(at, id);
                }
            }
            None => {
                self.by_recipient.insert(recipient.to_owned(), vec![id]);
            }
        }
    }

    fn index_remove(&mut self, recipient: &str, id: u64) {
        let now_empty = match self.by_recipient.get_mut(recipient) {
            Some(ids) => {
                ids.retain(|&x| x != id);
                ids.is_empty()
            }
            None => false,
        };
        // Drop empty lists so a fully paid recipient costs no storage.
        if now_empty {
            self.by_recipient.remove(recipient);
        }
    }

    /// Undo the removal done before a failed transfer: same id, same record.
    fn restore(&mut self, id: u64, payment: Payment) {
        self.index_add(&payment.recipient, id);
        self.payments.insert(id, payment);
    }
}

fn view(id: u64, p: &Payment) -> PaymentView {
    PaymentView {
        id: U64(id),
        sender: p.sender.clone(),
        token: p.token.clone(),
        amount: p.amount,
        recipient: p.recipient.clone(),
        expiry_ns: U64(p.expiry_ns),
    }
}

/// Decline a transfer: returning the full amount makes the token refund it.
fn refuse(amount: U128, why: &str) -> PromiseOrValue<U128> {
    env::log_str(&format!("refunding {}: {why}", amount.0));
    PromiseOrValue::Value(amount)
}

fn ft_transfer(
    token: AccountId,
    receiver_id: AccountId,
    amount: u128,
    memo: Option<String>,
) -> Promise {
    // NEP-141 demands exactly 1 yoctoNEAR on ft_transfer. Weight 0: leftover
    // gas goes to the callback, which is the step that must not run dry.
    ext_ft::ext(token)
        .with_attached_deposit(ONE_YOCTO)
        .with_static_gas(FT_TRANSFER_GAS)
        .with_unused_gas_weight(0)
        .ft_transfer(receiver_id, U128(amount), memo)
}

fn callback_gas(payments: u64) -> Gas {
    CALLBACK_GAS.saturating_add(RESTORE_GAS_PER_PAYMENT.saturating_mul(payments))
}

/// Fail early, with a readable message, when the caller attached too little
/// gas for the transfers and a callback that can undo them. (The runtime
/// would also refuse to schedule them, reverting everything, but with a
/// vaguer error.)
fn require_gas(needed: Gas) {
    let left = env::prepaid_gas().saturating_sub(env::used_gas());
    if left < needed {
        env::panic_str(&format!(
            "not enough gas: this call needs at least {} Tgas more; attach 300 Tgas",
            needed.as_tgas()
        ));
    }
}

fn sum_amounts(payments: &[(u64, Payment)]) -> Option<u128> {
    payments
        .iter()
        .try_fold(0u128, |sum, (_, p)| sum.checked_add(p.amount.0))
}

/// Whether the transfer at callback input `index` succeeded. Reads at most 0
/// bytes of its result: a successful `ft_transfer` returns nothing, and an
/// unexpected payload still means success, never a failure to refund.
fn transfer_succeeded(index: u64) -> bool {
    !matches!(
        env::promise_result_checked(index, 0),
        Err(PromiseError::Failed)
    )
}

/// Each token's minimum lives under its own storage key rather than in the
/// state struct, so contracts deployed before it existed upgrade in place:
/// their stored state still reads, and an unset token simply has no floor.
fn min_hold_key(token: &AccountId) -> Vec<u8> {
    [MIN_HOLD_PREFIX, token.as_bytes()].concat()
}

fn min_hold(token: &AccountId) -> u128 {
    env::storage_read(&min_hold_key(token))
        .and_then(|bytes| <[u8; 16]>::try_from(bytes).ok())
        .map(u128::from_le_bytes)
        .unwrap_or(0)
}

/// NEAR this account holds beyond what its current storage locks up.
fn spare_balance() -> NearToken {
    let locked = env::storage_byte_cost().saturating_mul(u128::from(env::storage_usage()));
    env::account_balance().saturating_sub(locked)
}
