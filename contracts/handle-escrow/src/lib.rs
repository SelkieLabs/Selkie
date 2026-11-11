//! Selkie handle-escrow: the contract that lets you pay someone who has no wallet.
//!
//! Stellar's native claimable balances need a real account at send time, so they
//! cannot hold money for "@amaka who has never joined". This contract can: a sender
//! locks any Stellar token against a *hash* of a social handle, and the funds sit in
//! the contract (not in any company wallet) until one of two things happens:
//!
//!  - the handle's owner signs in with that exact X/Telegram account, Selkie's
//!    oracle attests the login, and the contract releases the funds to the wallet
//!    that was just created for them; or
//!  - the payment expires unclaimed and the sender takes it back.
//!
//! What the chain sees is `sha256("x:<username>")`, never the handle itself:
//! pseudonymous, not secret, and consistent with Selkie's honest privacy story.
//!
//! Roles:
//!  - admin:  can rotate the oracle key. Nothing else.
//!  - oracle: Selkie's backend key. Its only power is releasing a payment to a
//!    recipient after a proven login. It can never move funds to itself, change
//!    amounts, or block a refund.
//!  - sender: can always refund an expired, unclaimed payment. Money is never stuck.
//!
//! Every fallible entry point returns `Result<_, Error>` rather than panicking, so
//! the error codes reach clients through the contract spec and the app can say
//! "this is not refundable yet" instead of "transaction failed".

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, BytesN, Env,
    Vec,
};

/// Ledgers per day at ~5s per ledger; used for storage lifetime bumps.
const DAY_IN_LEDGERS: u32 = 17_280;
/// Extend storage to ~120 days whenever an entry has less than ~60 left.
const BUMP_THRESHOLD: u32 = 60 * DAY_IN_LEDGERS;
const BUMP_AMOUNT: u32 = 120 * DAY_IN_LEDGERS;

/// A payment can wait for its recipient for at most a year before only
/// refund remains possible.
pub const MAX_LIFETIME_SECS: u64 = 365 * 24 * 60 * 60;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    InvalidAmount = 1,
    InvalidLifetime = 2,
    PaymentNotFound = 3,
    NotYetExpired = 4,
}

/// One locked payment, waiting to be claimed by the handle's owner.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Payment {
    pub sender: Address,
    pub token: Address,
    pub amount: i128,
    pub handle_hash: BytesN<32>,
    /// Unix time after which the sender may refund.
    pub expiry: u64,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Oracle,
    NextId,
    /// id -> Payment
    Payment(u64),
    /// handle hash -> ids of its pending payments
    Handle(BytesN<32>),
}

#[contract]
pub struct HandleEscrow;

#[contractimpl]
impl HandleEscrow {
    pub fn __constructor(env: Env, admin: Address, oracle: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Oracle, &oracle);
        env.storage().instance().set(&DataKey::NextId, &0u64);
    }

    /// Lock `amount` of `token` for the owner of `handle_hash`. The sender can
    /// refund once `lifetime` seconds have passed without a claim. Returns the
    /// payment id.
    pub fn deposit(
        env: Env,
        sender: Address,
        token: Address,
        amount: i128,
        handle_hash: BytesN<32>,
        lifetime: u64,
    ) -> Result<u64, Error> {
        sender.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if lifetime > MAX_LIFETIME_SECS {
            return Err(Error::InvalidLifetime);
        }

        // Pull the funds in first. If the sender cannot cover it, this traps and
        // no payment record is ever created.
        token::Client::new(&env, &token).transfer(
            &sender,
            &env.current_contract_address(),
            &amount,
        );

        let id: u64 = env.storage().instance().get(&DataKey::NextId).unwrap_or(0);
        env.storage().instance().set(&DataKey::NextId, &(id + 1));

        let expiry = env.ledger().timestamp().saturating_add(lifetime);
        let payment = Payment {
            sender: sender.clone(),
            token: token.clone(),
            amount,
            handle_hash: handle_hash.clone(),
            expiry,
        };
        let payment_key = DataKey::Payment(id);
        env.storage().persistent().set(&payment_key, &payment);
        env.storage()
            .persistent()
            .extend_ttl(&payment_key, BUMP_THRESHOLD, BUMP_AMOUNT);

        let handle_key = DataKey::Handle(handle_hash.clone());
        let mut ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&handle_key)
            .unwrap_or(Vec::new(&env));
        ids.push_back(id);
        env.storage().persistent().set(&handle_key, &ids);
        env.storage()
            .persistent()
            .extend_ttl(&handle_key, BUMP_THRESHOLD, BUMP_AMOUNT);

        env.storage()
            .instance()
            .extend_ttl(BUMP_THRESHOLD, BUMP_AMOUNT);

        env.events().publish(
            (symbol_short!("deposit"), handle_hash),
            (id, sender, token, amount, expiry),
        );
        Ok(id)
    }

    /// Release one payment to `recipient`. Only the oracle may call this, and it
    /// does so only after the handle's owner has proven ownership by logging in.
    pub fn claim(env: Env, id: u64, recipient: Address) -> Result<(), Error> {
        Self::oracle(env.clone()).require_auth();
        let payment = Self::take_payment(&env, id)?;
        token::Client::new(&env, &payment.token).transfer(
            &env.current_contract_address(),
            &recipient,
            &payment.amount,
        );
        env.events().publish(
            (symbol_short!("claim"), payment.handle_hash),
            (id, recipient, payment.token, payment.amount),
        );
        Ok(())
    }

    /// Release every pending payment for a handle to `recipient` in one call:
    /// the "sign in once, collect everything waiting for you" moment.
    /// Returns how many payments were released.
    pub fn claim_handle(env: Env, handle_hash: BytesN<32>, recipient: Address) -> Result<u32, Error> {
        Self::oracle(env.clone()).require_auth();
        let handle_key = DataKey::Handle(handle_hash.clone());
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&handle_key)
            .unwrap_or(Vec::new(&env));

        // Clear the index up front so a partially applied batch can never be
        // replayed against the same ids.
        env.storage().persistent().remove(&handle_key);

        let mut released: u32 = 0;
        for id in ids.iter() {
            let payment_key = DataKey::Payment(id);
            let Some(payment) = env
                .storage()
                .persistent()
                .get::<DataKey, Payment>(&payment_key)
            else {
                continue;
            };
            env.storage().persistent().remove(&payment_key);
            token::Client::new(&env, &payment.token).transfer(
                &env.current_contract_address(),
                &recipient,
                &payment.amount,
            );
            env.events().publish(
                (symbol_short!("claim"), payment.handle_hash),
                (id, recipient.clone(), payment.token, payment.amount),
            );
            released += 1;
        }
        Ok(released)
    }

    /// Return an expired, unclaimed payment to its sender. Anyone's money can
    /// wait, but nobody's money can be stuck.
    pub fn refund(env: Env, id: u64) -> Result<(), Error> {
        let payment: Payment = env
            .storage()
            .persistent()
            .get(&DataKey::Payment(id))
            .ok_or(Error::PaymentNotFound)?;
        payment.sender.require_auth();
        if env.ledger().timestamp() < payment.expiry {
            return Err(Error::NotYetExpired);
        }

        let payment = Self::take_payment(&env, id)?;
        token::Client::new(&env, &payment.token).transfer(
            &env.current_contract_address(),
            &payment.sender,
            &payment.amount,
        );
        env.events().publish(
            (symbol_short!("refund"), payment.handle_hash),
            (id, payment.sender, payment.token, payment.amount),
        );
        Ok(())
    }

    /// Ids of the payments still waiting for a handle.
    pub fn pending(env: Env, handle_hash: BytesN<32>) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::Handle(handle_hash))
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_payment(env: Env, id: u64) -> Option<Payment> {
        env.storage().persistent().get(&DataKey::Payment(id))
    }

    pub fn oracle(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Oracle).unwrap()
    }

    pub fn admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    /// Rotate the backend key that attests logins. Admin only.
    pub fn set_oracle(env: Env, new_oracle: Address) {
        Self::admin(env.clone()).require_auth();
        env.storage().instance().set(&DataKey::Oracle, &new_oracle);
        env.storage()
            .instance()
            .extend_ttl(BUMP_THRESHOLD, BUMP_AMOUNT);
    }

    /// Remove a payment and its index entry. Deleting state *before* any token
    /// moves is what makes double-claim and claim-after-refund impossible.
    fn take_payment(env: &Env, id: u64) -> Result<Payment, Error> {
        let payment_key = DataKey::Payment(id);
        let payment: Payment = env
            .storage()
            .persistent()
            .get(&payment_key)
            .ok_or(Error::PaymentNotFound)?;
        env.storage().persistent().remove(&payment_key);

        let handle_key = DataKey::Handle(payment.handle_hash.clone());
        if let Some(ids) = env
            .storage()
            .persistent()
            .get::<DataKey, Vec<u64>>(&handle_key)
        {
            if let Some(pos) = ids.first_index_of(id) {
                let mut ids = ids;
                ids.remove(pos);
                if ids.is_empty() {
                    env.storage().persistent().remove(&handle_key);
                } else {
                    env.storage().persistent().set(&handle_key, &ids);
                }
            }
        }
        Ok(payment)
    }
}

mod test;
