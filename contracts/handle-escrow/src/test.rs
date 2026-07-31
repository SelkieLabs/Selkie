#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{
    Address as _, AuthorizedFunction, AuthorizedInvocation, Ledger, MockAuth, MockAuthInvoke,
};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{vec, Env, IntoVal, Symbol};

struct Setup {
    env: Env,
    client: HandleEscrowClient<'static>,
    admin: Address,
    oracle: Address,
    sender: Address,
    recipient: Address,
    token: Address,
    token_client: TokenClient<'static>,
}

const HANDLE: [u8; 32] = [7u8; 32]; // stands in for sha256("x:amaka")
const OTHER_HANDLE: [u8; 32] = [9u8; 32];
const HOUR: u64 = 3_600;
const START_BALANCE: i128 = 1_000;

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    let sender = Address::generate(&env);
    let recipient = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = sac.address();
    StellarAssetClient::new(&env, &token).mint(&sender, &START_BALANCE);

    let contract_id = env.register(HandleEscrow, (&admin, &oracle));
    let client = HandleEscrowClient::new(&env, &contract_id);

    Setup {
        token_client: TokenClient::new(&env, &token),
        env,
        client,
        admin,
        oracle,
        sender,
        recipient,
        token,
    }
}

fn handle(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &HANDLE)
}

fn other_handle(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &OTHER_HANDLE)
}

// ---------------------------------------------------------------------------
// deposit
// ---------------------------------------------------------------------------

#[test]
fn deposit_locks_funds_and_indexes_them() {
    let s = setup();
    let id = s
        .client
        .deposit(&s.sender, &s.token, &250, &handle(&s.env), &HOUR);

    assert_eq!(id, 0);
    assert_eq!(s.token_client.balance(&s.sender), 750);
    assert_eq!(s.token_client.balance(&s.client.address), 250);
    assert_eq!(s.client.pending(&handle(&s.env)), vec![&s.env, 0]);

    let payment = s.client.get_payment(&id).unwrap();
    assert_eq!(payment.sender, s.sender);
    assert_eq!(payment.token, s.token);
    assert_eq!(payment.amount, 250);
    assert_eq!(payment.handle_hash, handle(&s.env));
    assert_eq!(payment.expiry, s.env.ledger().timestamp() + HOUR);
}

#[test]
fn deposit_rejects_zero_and_negative_amounts() {
    let s = setup();
    for bad in [0i128, -5, i128::MIN] {
        assert_eq!(
            s.client
                .try_deposit(&s.sender, &s.token, &bad, &handle(&s.env), &HOUR),
            Err(Ok(Error::InvalidAmount))
        );
    }
    // Nothing was taken from the sender.
    assert_eq!(s.token_client.balance(&s.sender), START_BALANCE);
}

#[test]
fn deposit_rejects_lifetime_beyond_a_year() {
    let s = setup();
    assert_eq!(
        s.client.try_deposit(
            &s.sender,
            &s.token,
            &10,
            &handle(&s.env),
            &(MAX_LIFETIME_SECS + 1)
        ),
        Err(Ok(Error::InvalidLifetime))
    );
    assert_eq!(s.token_client.balance(&s.sender), START_BALANCE);
}

#[test]
fn deposit_accepts_the_maximum_lifetime() {
    let s = setup();
    let id = s.client.deposit(
        &s.sender,
        &s.token,
        &10,
        &handle(&s.env),
        &MAX_LIFETIME_SECS,
    );
    assert_eq!(
        s.client.get_payment(&id).unwrap().expiry,
        s.env.ledger().timestamp() + MAX_LIFETIME_SECS
    );
}

#[test]
fn deposit_beyond_balance_fails_and_creates_no_payment() {
    let s = setup();
    assert!(s
        .client
        .try_deposit(
            &s.sender,
            &s.token,
            &(START_BALANCE + 1),
            &handle(&s.env),
            &HOUR
        )
        .is_err());
    assert_eq!(s.client.get_payment(&0), None);
    assert_eq!(s.client.pending(&handle(&s.env)), vec![&s.env]);
    assert_eq!(s.token_client.balance(&s.client.address), 0);
}

#[test]
fn deposit_requires_sender_auth() {
    let s = setup();
    s.client
        .deposit(&s.sender, &s.token, &100, &handle(&s.env), &HOUR);

    let (who, invocation) = s.env.auths().first().unwrap().clone();
    assert_eq!(who, s.sender);
    match invocation.function {
        AuthorizedFunction::Contract((contract, fn_name, _)) => {
            assert_eq!(contract, s.client.address);
            assert_eq!(fn_name, Symbol::new(&s.env, "deposit"));
        }
        _ => panic!("expected a contract authorization"),
    }
}

#[test]
fn deposit_without_any_auth_fails() {
    let s = setup();
    s.env.set_auths(&[]);
    assert!(s
        .client
        .try_deposit(&s.sender, &s.token, &100, &handle(&s.env), &HOUR)
        .is_err());
}

#[test]
fn ids_increment_across_deposits() {
    let s = setup();
    let a = s
        .client
        .deposit(&s.sender, &s.token, &10, &handle(&s.env), &HOUR);
    let b = s
        .client
        .deposit(&s.sender, &s.token, &10, &handle(&s.env), &HOUR);
    assert_eq!((a, b), (0, 1));
}

#[test]
fn expiry_saturates_instead_of_overflowing() {
    let s = setup();
    s.env.ledger().with_mut(|l| l.timestamp = u64::MAX - 5);
    let id = s
        .client
        .deposit(&s.sender, &s.token, &10, &handle(&s.env), &HOUR);

    // Wrapping here would have produced a tiny expiry and made the payment
    // instantly refundable, letting a sender yank funds out from under a claim.
    assert_eq!(s.client.get_payment(&id).unwrap().expiry, u64::MAX);
    assert_eq!(s.client.try_refund(&id), Err(Ok(Error::NotYetExpired)));
}

// ---------------------------------------------------------------------------
// claim
// ---------------------------------------------------------------------------

#[test]
fn claim_releases_to_recipient_and_clears_state() {
    let s = setup();
    let id = s
        .client
        .deposit(&s.sender, &s.token, &250, &handle(&s.env), &HOUR);
    s.client.claim(&id, &s.recipient);

    assert_eq!(s.token_client.balance(&s.recipient), 250);
    assert_eq!(s.token_client.balance(&s.client.address), 0);
    assert_eq!(s.client.pending(&handle(&s.env)), vec![&s.env]);
    assert_eq!(s.client.get_payment(&id), None);
}

#[test]
fn claim_is_authorized_by_the_oracle() {
    let s = setup();
    let id = s
        .client
        .deposit(&s.sender, &s.token, &100, &handle(&s.env), &HOUR);
    s.client.claim(&id, &s.recipient);

    let auths = s.env.auths();
    let (who, invocation) = auths.first().unwrap().clone();
    assert_eq!(who, s.oracle);
    match invocation.function {
        AuthorizedFunction::Contract((_, fn_name, _)) => {
            assert_eq!(fn_name, Symbol::new(&s.env, "claim"));
        }
        _ => panic!("expected a contract authorization"),
    }
}

#[test]
fn claim_unknown_payment_fails() {
    let s = setup();
    assert_eq!(
        s.client.try_claim(&99, &s.recipient),
        Err(Ok(Error::PaymentNotFound))
    );
}

#[test]
fn double_claim_fails() {
    let s = setup();
    let id = s
        .client
        .deposit(&s.sender, &s.token, &100, &handle(&s.env), &HOUR);
    s.client.claim(&id, &s.recipient);

    assert_eq!(
        s.client.try_claim(&id, &s.recipient),
        Err(Ok(Error::PaymentNotFound))
    );
    // The recipient was paid exactly once.
    assert_eq!(s.token_client.balance(&s.recipient), 100);
}

#[test]
fn single_claim_leaves_other_payments_pending() {
    let s = setup();
    let id0 = s
        .client
        .deposit(&s.sender, &s.token, &100, &handle(&s.env), &HOUR);
    let id1 = s
        .client
        .deposit(&s.sender, &s.token, &150, &handle(&s.env), &HOUR);

    s.client.claim(&id0, &s.recipient);

    assert_eq!(s.client.pending(&handle(&s.env)), vec![&s.env, id1]);
    assert_eq!(s.client.get_payment(&id1).unwrap().amount, 150);
    assert_eq!(s.token_client.balance(&s.client.address), 150);
}

// ---------------------------------------------------------------------------
// claim_handle
// ---------------------------------------------------------------------------

#[test]
fn claim_handle_releases_everything_waiting() {
    let s = setup();
    // Two senders paid the same handle before its owner ever joined.
    let sender2 = Address::generate(&s.env);
    StellarAssetClient::new(&s.env, &s.token).mint(&sender2, &500);

    s.client
        .deposit(&s.sender, &s.token, &250, &handle(&s.env), &HOUR);
    s.client
        .deposit(&sender2, &s.token, &400, &handle(&s.env), &HOUR);

    let released = s.client.claim_handle(&handle(&s.env), &s.recipient);

    assert_eq!(released, 2);
    assert_eq!(s.token_client.balance(&s.recipient), 650);
    assert_eq!(s.token_client.balance(&s.client.address), 0);
    assert_eq!(s.client.pending(&handle(&s.env)), vec![&s.env]);
}

#[test]
fn claim_handle_with_nothing_pending_releases_zero() {
    let s = setup();
    assert_eq!(s.client.claim_handle(&handle(&s.env), &s.recipient), 0);
    assert_eq!(s.token_client.balance(&s.recipient), 0);
}

#[test]
fn claim_handle_collects_across_different_tokens() {
    let s = setup();
    let other_sac = s
        .env
        .register_stellar_asset_contract_v2(Address::generate(&s.env));
    let other_token = other_sac.address();
    StellarAssetClient::new(&s.env, &other_token).mint(&s.sender, &300);

    s.client
        .deposit(&s.sender, &s.token, &100, &handle(&s.env), &HOUR);
    s.client
        .deposit(&s.sender, &other_token, &300, &handle(&s.env), &HOUR);

    assert_eq!(s.client.claim_handle(&handle(&s.env), &s.recipient), 2);
    assert_eq!(s.token_client.balance(&s.recipient), 100);
    assert_eq!(
        TokenClient::new(&s.env, &other_token).balance(&s.recipient),
        300
    );
}

#[test]
fn claim_handle_then_individual_claim_fails() {
    let s = setup();
    let id = s
        .client
        .deposit(&s.sender, &s.token, &100, &handle(&s.env), &HOUR);
    s.client.claim_handle(&handle(&s.env), &s.recipient);

    assert_eq!(
        s.client.try_claim(&id, &s.recipient),
        Err(Ok(Error::PaymentNotFound))
    );
    assert_eq!(s.token_client.balance(&s.recipient), 100);
}

#[test]
fn claim_handle_twice_releases_nothing_the_second_time() {
    let s = setup();
    s.client
        .deposit(&s.sender, &s.token, &100, &handle(&s.env), &HOUR);

    assert_eq!(s.client.claim_handle(&handle(&s.env), &s.recipient), 1);
    assert_eq!(s.client.claim_handle(&handle(&s.env), &s.recipient), 0);
    assert_eq!(s.token_client.balance(&s.recipient), 100);
}

#[test]
fn handles_are_isolated_from_each_other() {
    let s = setup();
    s.client
        .deposit(&s.sender, &s.token, &100, &handle(&s.env), &HOUR);
    s.client
        .deposit(&s.sender, &s.token, &200, &other_handle(&s.env), &HOUR);

    assert_eq!(s.client.claim_handle(&handle(&s.env), &s.recipient), 1);
    assert_eq!(s.token_client.balance(&s.recipient), 100);
    // The other handle's money is untouched.
    assert_eq!(s.client.pending(&other_handle(&s.env)).len(), 1);
    assert_eq!(s.token_client.balance(&s.client.address), 200);
}

// ---------------------------------------------------------------------------
// refund
// ---------------------------------------------------------------------------

#[test]
fn refund_before_expiry_fails() {
    let s = setup();
    let id = s
        .client
        .deposit(&s.sender, &s.token, &100, &handle(&s.env), &HOUR);
    assert_eq!(s.client.try_refund(&id), Err(Ok(Error::NotYetExpired)));
    assert_eq!(s.token_client.balance(&s.client.address), 100);
}

#[test]
fn refund_exactly_at_expiry_succeeds() {
    let s = setup();
    let id = s
        .client
        .deposit(&s.sender, &s.token, &100, &handle(&s.env), &HOUR);

    let expiry = s.client.get_payment(&id).unwrap().expiry;
    s.env.ledger().with_mut(|l| l.timestamp = expiry);
    s.client.refund(&id);

    assert_eq!(s.token_client.balance(&s.sender), START_BALANCE);
}

#[test]
fn refund_after_expiry_returns_funds_to_sender() {
    let s = setup();
    let id = s
        .client
        .deposit(&s.sender, &s.token, &100, &handle(&s.env), &HOUR);

    let now = s.env.ledger().timestamp();
    s.env.ledger().with_mut(|l| l.timestamp = now + HOUR + 1);
    s.client.refund(&id);

    assert_eq!(s.token_client.balance(&s.sender), START_BALANCE);
    assert_eq!(s.token_client.balance(&s.client.address), 0);
    assert_eq!(s.client.pending(&handle(&s.env)), vec![&s.env]);
    assert_eq!(s.client.get_payment(&id), None);
}

#[test]
fn zero_lifetime_is_refundable_immediately() {
    let s = setup();
    let id = s
        .client
        .deposit(&s.sender, &s.token, &100, &handle(&s.env), &0);
    s.client.refund(&id);
    assert_eq!(s.token_client.balance(&s.sender), START_BALANCE);
}

#[test]
fn refund_unknown_payment_fails() {
    let s = setup();
    assert_eq!(s.client.try_refund(&404), Err(Ok(Error::PaymentNotFound)));
}

#[test]
fn refund_is_authorized_by_the_original_sender() {
    let s = setup();
    let id = s
        .client
        .deposit(&s.sender, &s.token, &100, &handle(&s.env), &0);
    s.client.refund(&id);

    let auths = s.env.auths();
    let (who, AuthorizedInvocation { function, .. }) = auths.first().unwrap().clone();
    assert_eq!(who, s.sender);
    match function {
        AuthorizedFunction::Contract((_, fn_name, _)) => {
            assert_eq!(fn_name, Symbol::new(&s.env, "refund"));
        }
        _ => panic!("expected a contract authorization"),
    }
}

#[test]
fn double_refund_fails() {
    let s = setup();
    let id = s
        .client
        .deposit(&s.sender, &s.token, &100, &handle(&s.env), &0);
    s.client.refund(&id);

    assert_eq!(s.client.try_refund(&id), Err(Ok(Error::PaymentNotFound)));
    assert_eq!(s.token_client.balance(&s.sender), START_BALANCE);
}

#[test]
fn refunded_payment_cannot_be_claimed() {
    let s = setup();
    let id = s
        .client
        .deposit(&s.sender, &s.token, &100, &handle(&s.env), &0);
    s.client.refund(&id);

    assert_eq!(
        s.client.try_claim(&id, &s.recipient),
        Err(Ok(Error::PaymentNotFound))
    );
    assert_eq!(s.token_client.balance(&s.recipient), 0);
}

#[test]
fn claimed_payment_cannot_be_refunded() {
    let s = setup();
    let id = s
        .client
        .deposit(&s.sender, &s.token, &100, &handle(&s.env), &0);
    s.client.claim(&id, &s.recipient);

    assert_eq!(s.client.try_refund(&id), Err(Ok(Error::PaymentNotFound)));
    assert_eq!(s.token_client.balance(&s.recipient), 100);
    assert_eq!(s.token_client.balance(&s.sender), START_BALANCE - 100);
}

// ---------------------------------------------------------------------------
// Attack cases. These are the tests that matter most: they prove that holding
// the wrong key gets you nothing.
// ---------------------------------------------------------------------------

#[test]
fn attacker_cannot_claim_someone_elses_payment() {
    let s = setup();
    let id = s
        .client
        .deposit(&s.sender, &s.token, &250, &handle(&s.env), &HOUR);

    let attacker = Address::generate(&s.env);
    s.env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &s.client.address,
            fn_name: "claim",
            args: (id, attacker.clone()).into_val(&s.env),
            sub_invokes: &[],
        },
    }]);

    assert!(s.client.try_claim(&id, &attacker).is_err());
    assert_eq!(s.token_client.balance(&attacker), 0);
    assert_eq!(s.token_client.balance(&s.client.address), 250);
    assert_eq!(s.client.pending(&handle(&s.env)), vec![&s.env, id]);
}

#[test]
fn attacker_cannot_drain_a_handle() {
    let s = setup();
    s.client
        .deposit(&s.sender, &s.token, &250, &handle(&s.env), &HOUR);

    let attacker = Address::generate(&s.env);
    s.env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &s.client.address,
            fn_name: "claim_handle",
            args: (handle(&s.env), attacker.clone()).into_val(&s.env),
            sub_invokes: &[],
        },
    }]);

    assert!(s
        .client
        .try_claim_handle(&handle(&s.env), &attacker)
        .is_err());
    assert_eq!(s.token_client.balance(&attacker), 0);
    assert_eq!(s.token_client.balance(&s.client.address), 250);
}

#[test]
fn claim_with_no_auth_at_all_fails() {
    let s = setup();
    let id = s
        .client
        .deposit(&s.sender, &s.token, &100, &handle(&s.env), &HOUR);

    s.env.set_auths(&[]);
    assert!(s.client.try_claim(&id, &s.recipient).is_err());
    assert_eq!(s.token_client.balance(&s.client.address), 100);
}

#[test]
fn attacker_cannot_refund_someone_elses_payment() {
    let s = setup();
    let id = s
        .client
        .deposit(&s.sender, &s.token, &100, &handle(&s.env), &0);

    let attacker = Address::generate(&s.env);
    s.env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &s.client.address,
            fn_name: "refund",
            args: (id,).into_val(&s.env),
            sub_invokes: &[],
        },
    }]);

    // Expired and refundable, but only by the sender.
    assert!(s.client.try_refund(&id).is_err());
    assert_eq!(s.token_client.balance(&s.client.address), 100);
    assert_eq!(s.token_client.balance(&s.sender), START_BALANCE - 100);
}

#[test]
fn oracle_cannot_rotate_itself() {
    let s = setup();
    let attacker = Address::generate(&s.env);

    // Even the oracle key, the one the backend holds, cannot promote a new
    // oracle. That power belongs to the admin alone.
    s.env.mock_auths(&[MockAuth {
        address: &s.oracle,
        invoke: &MockAuthInvoke {
            contract: &s.client.address,
            fn_name: "set_oracle",
            args: (attacker.clone(),).into_val(&s.env),
            sub_invokes: &[],
        },
    }]);

    assert!(s.client.try_set_oracle(&attacker).is_err());
    assert_eq!(s.client.oracle(), s.oracle);
}

#[test]
fn attacker_cannot_rotate_the_oracle() {
    let s = setup();
    let attacker = Address::generate(&s.env);
    s.env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &s.client.address,
            fn_name: "set_oracle",
            args: (attacker.clone(),).into_val(&s.env),
            sub_invokes: &[],
        },
    }]);

    assert!(s.client.try_set_oracle(&attacker).is_err());
    assert_eq!(s.client.oracle(), s.oracle);
}

#[test]
fn a_rotated_oracle_takes_over_and_the_old_one_is_powerless() {
    let s = setup();
    let id = s
        .client
        .deposit(&s.sender, &s.token, &100, &handle(&s.env), &HOUR);

    let new_oracle = Address::generate(&s.env);
    s.client.set_oracle(&new_oracle);
    assert_eq!(s.client.oracle(), new_oracle);

    // The old oracle key is now worthless, which is the point of rotation.
    let old_oracle = s.oracle.clone();
    s.env.mock_auths(&[MockAuth {
        address: &old_oracle,
        invoke: &MockAuthInvoke {
            contract: &s.client.address,
            fn_name: "claim",
            args: (id, s.recipient.clone()).into_val(&s.env),
            sub_invokes: &[],
        },
    }]);
    assert!(s.client.try_claim(&id, &s.recipient).is_err());

    // The new one works.
    s.env.mock_all_auths();
    s.client.claim(&id, &s.recipient);
    assert_eq!(s.token_client.balance(&s.recipient), 100);
}

#[test]
fn sender_cannot_reclaim_by_depositing_to_a_handle_they_do_not_own() {
    let s = setup();
    // Money addressed to a handle is not the sender's to release, no matter
    // that they funded it. Only the oracle can release, only after a login.
    let id = s
        .client
        .deposit(&s.sender, &s.token, &100, &handle(&s.env), &HOUR);

    s.env.mock_auths(&[MockAuth {
        address: &s.sender,
        invoke: &MockAuthInvoke {
            contract: &s.client.address,
            fn_name: "claim",
            args: (id, s.sender.clone()).into_val(&s.env),
            sub_invokes: &[],
        },
    }]);

    assert!(s.client.try_claim(&id, &s.sender).is_err());
    assert_eq!(s.token_client.balance(&s.client.address), 100);
}

// ---------------------------------------------------------------------------
// roles and views
// ---------------------------------------------------------------------------

#[test]
fn constructor_wires_roles() {
    let s = setup();
    assert_eq!(s.client.admin(), s.admin);
    assert_eq!(s.client.oracle(), s.oracle);
}

#[test]
fn admin_can_rotate_the_oracle() {
    let s = setup();
    let new_oracle = Address::generate(&s.env);
    s.client.set_oracle(&new_oracle);

    // Read the auths before any other invocation: every call resets them.
    let (who, _) = s.env.auths().first().unwrap().clone();
    assert_eq!(who, s.admin);
    assert_eq!(s.client.oracle(), new_oracle);
}

#[test]
fn views_are_empty_for_unknown_keys() {
    let s = setup();
    assert_eq!(s.client.get_payment(&123), None);
    assert_eq!(s.client.pending(&other_handle(&s.env)), vec![&s.env]);
}
