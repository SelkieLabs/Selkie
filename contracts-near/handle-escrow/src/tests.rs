//! Unit tests against near-sdk's mocked blockchain. Payouts are checked end to
//! end: the receipts `claim` / `refund` schedule are decoded, and their
//! callback is then called with exactly the arguments the chain would pass,
//! under a success or failure promise result.

use super::*;
use near_sdk::mock::MockAction;
use near_sdk::serde::Deserialize;
use near_sdk::serde_json::{self, Value, json};
use near_sdk::test_utils::{VMContextBuilder, get_created_receipts, get_logs};
use near_sdk::{PromiseResult, RuntimeFeesConfig, test_vm_config, testing_env};

const KEY_A: &str = "4f0d2a1a8b6c0e5f9d3b7a2c1e0f9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e";
const KEY_B: &str = "b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2";
const SEC: u64 = 1_000_000_000;
const DAY_SECS: u64 = 24 * 60 * 60;
const MAX_LIFETIME: u64 = 365 * DAY_SECS;
/// Block time of the holds; refunds open at T0 + lifetime.
const T0: u64 = 1_800_000_000 * SEC;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn escrow() -> AccountId {
    acc("escrow.testnet")
}
fn owner() -> AccountId {
    acc("owner.testnet")
}
fn oracle() -> AccountId {
    acc("oracle.testnet")
}
fn usdc() -> AccountId {
    acc("usdc.testnet")
}
fn eurc() -> AccountId {
    acc("eurc.testnet")
}
fn alice() -> AccountId {
    acc("alice.testnet")
}
fn bob() -> AccountId {
    acc("bob.testnet")
}
fn amaka() -> AccountId {
    acc("amaka.testnet")
}

/// Make the next call come from `predecessor` at block time `now`.
fn ctx(predecessor: AccountId, now: u64) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(escrow())
            .predecessor_account_id(predecessor)
            .block_timestamp(now)
            .build()
    );
}

/// Make the next call come from `predecessor` with `deposit` attached, the way
/// a wallet signs an owner method.
fn ctx_paying(predecessor: AccountId, deposit: NearToken) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(escrow())
            .predecessor_account_id(predecessor)
            .block_timestamp(T0)
            .attached_deposit(deposit)
            .build()
    );
}

/// An owner call, with the 1 yoctoNEAR every owner method wants.
fn as_owner() {
    ctx_paying(owner(), NearToken::from_yoctonear(1));
}

/// Make the next call a callback seeing `results` from the promises before it.
fn callback_ctx(results: Vec<PromiseResult>) {
    let context = VMContextBuilder::new()
        .current_account_id(escrow())
        .predecessor_account_id(escrow())
        .block_timestamp(T0)
        .build();
    testing_env!(
        context,
        test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        results
    );
}

fn setup() -> HandleEscrow {
    ctx(escrow(), T0);
    HandleEscrow::new(owner(), oracle(), vec![usdc()], MAX_LIFETIME)
}

fn value<T>(v: PromiseOrValue<T>) -> T {
    match v {
        PromiseOrValue::Value(v) => v,
        PromiseOrValue::Promise(_) => panic!("expected a value, got a promise"),
    }
}

fn promise<T>(v: PromiseOrValue<T>) -> Promise {
    match v {
        PromiseOrValue::Promise(p) => p,
        PromiseOrValue::Value(_) => panic!("expected a promise, got a value"),
    }
}

/// Send `amount` of `token` with `msg`; returns what the token must refund.
fn send(
    c: &mut HandleEscrow,
    token: AccountId,
    sender: AccountId,
    amount: u128,
    msg: Value,
) -> u128 {
    ctx(token, T0);
    value(c.ft_on_transfer(sender, U128(amount), msg.to_string())).0
}

fn hold(
    c: &mut HandleEscrow,
    sender: AccountId,
    amount: u128,
    recipient: &str,
    lifetime: u64,
) -> u128 {
    let msg = json!({"kind": "hold", "recipient": recipient, "lifetime_secs": lifetime});
    send(c, usdc(), sender, amount, msg)
}

/// A function call the contract scheduled.
#[derive(Debug)]
struct Call {
    receiver: AccountId,
    method: String,
    args: Value,
    deposit: NearToken,
    gas: Gas,
    weight: u64,
}

/// Every function call scheduled so far in the current context.
fn scheduled() -> Vec<Call> {
    let mut calls = Vec::new();
    for receipt in get_created_receipts() {
        for action in receipt.actions {
            if let MockAction::FunctionCallWeight {
                method_name,
                args,
                attached_deposit,
                prepaid_gas,
                gas_weight,
                ..
            } = action
            {
                calls.push(Call {
                    receiver: receipt.receiver_id.clone(),
                    method: String::from_utf8(method_name).unwrap(),
                    args: serde_json::from_slice(&args).unwrap(),
                    deposit: attached_deposit,
                    gas: prepaid_gas,
                    weight: gas_weight.0,
                });
            }
        }
    }
    calls
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct ClaimCallback {
    recipient: String,
    account_id: AccountId,
    groups: Vec<ClaimGroup>,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct RefundCallback {
    id: U64,
    payment: Payment,
}

/// Run `claim` as the oracle and return its scheduled calls (transfers, then
/// the callback).
fn claim(c: &mut HandleEscrow, recipient: &str, to: AccountId) -> Vec<Call> {
    ctx(oracle(), T0);
    drop(promise(c.claim(recipient.to_string(), to)));
    scheduled()
}

/// Finish a claim the way the chain would: call its callback with the
/// scheduled arguments and one result per transfer.
fn resolve_claim(c: &mut HandleEscrow, calls: &[Call], results: Vec<PromiseResult>) -> u32 {
    let cb = calls
        .iter()
        .find(|call| call.method == "on_claim_resolved")
        .expect("callback scheduled");
    let args: ClaimCallback = serde_json::from_value(cb.args.clone()).unwrap();
    callback_ctx(results);
    c.on_claim_resolved(args.recipient, args.account_id, args.groups)
}

fn refund(c: &mut HandleEscrow, sender: AccountId, id: u64, now: u64) -> Vec<Call> {
    ctx(sender, now);
    drop(c.refund(U64(id)));
    scheduled()
}

fn resolve_refund(c: &mut HandleEscrow, calls: &[Call], result: PromiseResult) -> bool {
    let cb = calls
        .iter()
        .find(|call| call.method == "on_refund_resolved")
        .expect("callback scheduled");
    let args: RefundCallback = serde_json::from_value(cb.args.clone()).unwrap();
    callback_ctx(vec![result]);
    c.on_refund_resolved(args.id, args.payment)
}

fn ok() -> PromiseResult {
    PromiseResult::Successful(vec![])
}

/// The `data` of every event named `name` in the current context's logs.
fn events(name: &str) -> Vec<Value> {
    get_logs()
        .iter()
        .filter_map(|log| log.strip_prefix("EVENT_JSON:"))
        .map(|body| serde_json::from_str::<Value>(body).unwrap())
        .filter(|e| e["event"] == name)
        .map(|e| {
            assert_eq!(e["standard"], "selkie");
            assert_eq!(e["version"], "1.0.0");
            e["data"].clone()
        })
        .collect()
}

fn pending_ids(c: &HandleEscrow, recipient: &str) -> Vec<u64> {
    c.pending(recipient.to_string())
        .iter()
        .map(|p| p.id.0)
        .collect()
}

// ---- holding ---------------------------------------------------------------

#[test]
fn hold_then_claim() {
    let mut c = setup();
    assert_eq!(hold(&mut c, alice(), 1_000_000, KEY_A, 60), 0);
    let held = c.pending(KEY_A.into());
    assert_eq!(
        held,
        vec![PaymentView {
            id: U64(0),
            sender: alice(),
            token: usdc(),
            amount: U128(1_000_000),
            recipient: KEY_A.into(),
            expiry_ns: U64(T0 + 60 * SEC),
        }]
    );

    let calls = claim(&mut c, KEY_A, amaka());
    // Records go before any money moves.
    assert!(c.pending(KEY_A.into()).is_empty());
    assert!(c.get_payment(U64(0)).is_none());

    assert_eq!(calls.len(), 2);
    let transfer = &calls[0];
    assert_eq!(transfer.receiver, usdc());
    assert_eq!(transfer.method, "ft_transfer");
    assert_eq!(transfer.args["receiver_id"], "amaka.testnet");
    assert_eq!(transfer.args["amount"], "1000000");
    assert_eq!(transfer.deposit, NearToken::from_yoctonear(1));
    assert_eq!(transfer.gas, FT_TRANSFER_GAS);
    assert_eq!(transfer.weight, 0);
    let callback = &calls[1];
    assert_eq!(callback.receiver, escrow());
    assert_eq!(callback.deposit, NearToken::from_yoctonear(0));
    assert_eq!(
        callback.gas,
        CALLBACK_GAS.saturating_add(RESTORE_GAS_PER_PAYMENT)
    );

    assert_eq!(resolve_claim(&mut c, &calls, vec![ok()]), 1);
    assert!(c.pending(KEY_A.into()).is_empty());
    assert!(c.get_payment(U64(0)).is_none());
    assert_eq!(events("claim").len(), 1);
    assert!(events("claim_failed").is_empty());
}

#[test]
fn hold_many_then_claim() {
    let mut c = setup();
    let msg = json!({
        "kind": "hold_many",
        "lifetime_secs": DAY_SECS,
        "items": [
            {"recipient": KEY_A, "amount": "300"},
            {"recipient": KEY_B, "amount": "200"},
            {"recipient": KEY_A, "amount": "500"},
        ]
    });
    assert_eq!(send(&mut c, usdc(), alice(), 1_000, msg), 0);
    assert_eq!(pending_ids(&c, KEY_A), vec![0, 2]);
    assert_eq!(pending_ids(&c, KEY_B), vec![1]);
    assert_eq!(events("hold").len(), 1);
    assert_eq!(events("hold")[0].as_array().unwrap().len(), 3);

    let calls = claim(&mut c, KEY_A, amaka());
    // Both of KEY_A's payments go out as one transfer of their total.
    assert_eq!(
        calls.iter().filter(|c| c.method == "ft_transfer").count(),
        1
    );
    assert_eq!(calls[0].args["amount"], "800");
    assert_eq!(resolve_claim(&mut c, &calls, vec![ok()]), 2);

    let claimed = &events("claim")[0][0];
    assert_eq!(claimed["ids"], json!(["0", "2"]));
    assert_eq!(claimed["amount"], "800");
    // The other recipient is untouched.
    assert_eq!(pending_ids(&c, KEY_B), vec![1]);
}

#[test]
fn wrong_token_is_refunded() {
    let mut c = setup();
    let msg = json!({"kind": "hold", "recipient": KEY_A, "lifetime_secs": 60});
    assert_eq!(send(&mut c, acc("fake-usdc.testnet"), alice(), 5, msg), 5);
    assert!(c.pending(KEY_A.into()).is_empty());
    assert!(c.get_payment(U64(0)).is_none());
    assert!(events("hold").is_empty());
}

#[test]
fn bad_msg_is_refunded() {
    let mut c = setup();
    let upper = KEY_A.to_uppercase();
    let short = &KEY_A[..63];
    let bad = [
        "not json".to_string(),
        "".to_string(),
        json!({"kind": "steal", "recipient": KEY_A, "lifetime_secs": 60}).to_string(),
        json!({"recipient": KEY_A, "lifetime_secs": 60}).to_string(),
        json!({"kind": "hold", "recipient": upper, "lifetime_secs": 60}).to_string(),
        json!({"kind": "hold", "recipient": short, "lifetime_secs": 60}).to_string(),
        json!({"kind": "hold", "recipient": format!("{KEY_A}0"), "lifetime_secs": 60}).to_string(),
        json!({"kind": "hold", "recipient": format!("x:{}", &KEY_A[2..]), "lifetime_secs": 60}).to_string(),
        json!({"kind": "hold", "lifetime_secs": 60}).to_string(),
        json!({"kind": "hold", "recipient": KEY_A}).to_string(),
        json!({"kind": "hold", "recipient": KEY_A, "lifetime_secs": -1}).to_string(),
        json!({"kind": "hold", "recipient": KEY_A, "lifetime_secs": 60, "extra": 1}).to_string(),
        json!({"kind": "hold_many", "lifetime_secs": 60, "items": [{"recipient": KEY_A, "amount": 7}]})
            .to_string(),
        json!({"kind": "hold_many", "lifetime_secs": 60, "items": [{"recipient": "nope", "amount": "7"}]})
            .to_string(),
    ];
    for msg in bad {
        ctx(usdc(), T0);
        let refunded = value(c.ft_on_transfer(alice(), U128(7), msg.clone())).0;
        assert_eq!(refunded, 7, "msg {msg:?} should be refunded");
    }
    // A zero-amount transfer has nothing to hold either.
    assert_eq!(hold(&mut c, alice(), 0, KEY_A, 60), 0);
    assert!(c.pending(KEY_A.into()).is_empty());
    assert!(c.get_payment(U64(0)).is_none());
}

#[test]
fn hold_many_with_wrong_sum_is_refunded() {
    let mut c = setup();
    let many = |items: Value| json!({"kind": "hold_many", "lifetime_secs": 60, "items": items});
    let cases = [
        // Sum too low, sum too high.
        many(json!([{"recipient": KEY_A, "amount": "400"}, {"recipient": KEY_B, "amount": "500"}])),
        many(json!([{"recipient": KEY_A, "amount": "600"}, {"recipient": KEY_B, "amount": "500"}])),
        // A zero item, even when the sum matches.
        many(json!([{"recipient": KEY_A, "amount": "1000"}, {"recipient": KEY_B, "amount": "0"}])),
        // Overflowing items.
        many(json!([
            {"recipient": KEY_A, "amount": u128::MAX.to_string()},
            {"recipient": KEY_B, "amount": "1001"}
        ])),
        // Nothing, or one good recipient next to a bad one.
        many(json!([])),
        many(json!([{"recipient": KEY_A, "amount": "500"}, {"recipient": "zz", "amount": "500"}])),
    ];
    for msg in cases {
        assert_eq!(
            send(&mut c, usdc(), alice(), 1_000, msg.clone()),
            1_000,
            "{msg}"
        );
    }
    let too_many: Vec<Value> = (0..=MAX_HOLD_ITEMS)
        .map(|_| json!({"recipient": KEY_A, "amount": "1"}))
        .collect();
    let n = too_many.len() as u128;
    assert_eq!(send(&mut c, usdc(), alice(), n, many(json!(too_many))), n);

    assert!(c.pending(KEY_A.into()).is_empty());
    assert!(c.pending(KEY_B.into()).is_empty());
    assert!(c.get_payment(U64(0)).is_none());
}

#[test]
fn lifetime_zero_or_over_max_is_refunded() {
    let mut c = setup();
    assert_eq!(hold(&mut c, alice(), 10, KEY_A, 0), 10);
    assert_eq!(hold(&mut c, alice(), 10, KEY_A, MAX_LIFETIME + 1), 10);
    assert_eq!(hold(&mut c, alice(), 10, KEY_A, u64::MAX), 10);
    let many = json!({"kind": "hold_many", "lifetime_secs": 0, "items": [{"recipient": KEY_A, "amount": "10"}]});
    assert_eq!(send(&mut c, usdc(), alice(), 10, many), 10);
    assert!(c.pending(KEY_A.into()).is_empty());

    // The bounds themselves are fine.
    assert_eq!(hold(&mut c, alice(), 10, KEY_A, 1), 0);
    assert_eq!(hold(&mut c, alice(), 10, KEY_A, MAX_LIFETIME), 0);
    assert_eq!(
        c.get_payment(U64(1)).unwrap().expiry_ns,
        U64(T0 + MAX_LIFETIME * SEC)
    );
}

#[test]
fn largest_hold_many_event_fits_the_log_limit() {
    // Worst case for the event: 64-char accounts, 20-digit ids and expiry,
    // 37-digit amounts. NEAR fails a receipt whose logs pass 16 KiB.
    let long_token = acc(&"a".repeat(64));
    let long_sender = acc(&"b".repeat(64));
    ctx(escrow(), 10_000_000_000_000_000_000);
    let mut c = HandleEscrow::new(owner(), oracle(), vec![long_token.clone()], MAX_LIFETIME);
    c.next_id = 10_000_000_000_000_000_000;

    let each: u128 = 8 * 10u128.pow(36);
    let items: Vec<Value> = (0..MAX_HOLD_ITEMS)
        .map(|_| json!({"recipient": KEY_A, "amount": each.to_string()}))
        .collect();
    let msg = json!({"kind": "hold_many", "lifetime_secs": MAX_LIFETIME, "items": items});
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(escrow())
            .predecessor_account_id(long_token)
            .block_timestamp(10_000_000_000_000_000_000)
            .build()
    );
    let refunded = value(c.ft_on_transfer(
        long_sender,
        U128(each * MAX_HOLD_ITEMS as u128),
        msg.to_string(),
    ));
    assert_eq!(refunded.0, 0);
    let total_log_bytes: usize = get_logs().iter().map(String::len).sum();
    assert!(
        total_log_bytes < 16_384,
        "hold event is {total_log_bytes} bytes"
    );
    assert_eq!(c.pending(KEY_A.into()).len(), MAX_HOLD_ITEMS);
}

#[test]
fn hold_is_refused_when_the_escrow_is_low_on_near() {
    let mut c = setup();
    // 300 KiB of storage locks ~3.07 NEAR; leave ~0.2 NEAR spare.
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(escrow())
            .predecessor_account_id(usdc())
            .block_timestamp(T0)
            .account_balance(NearToken::from_millinear(3_300))
            .build()
    );
    let msg = json!({"kind": "hold", "recipient": KEY_A, "lifetime_secs": 60}).to_string();
    assert_eq!(value(c.ft_on_transfer(alice(), U128(10), msg)).0, 10);
    assert!(c.pending(KEY_A.into()).is_empty());
}

// ---- claiming --------------------------------------------------------------

#[test]
#[should_panic(expected = "only the oracle can claim")]
fn non_oracle_claim_fails() {
    let mut c = setup();
    hold(&mut c, alice(), 100, KEY_A, 60);
    ctx(alice(), T0);
    let _ = c.claim(KEY_A.into(), alice());
}

#[test]
fn claim_with_nothing_pending_returns_zero() {
    let mut c = setup();
    ctx(oracle(), T0);
    assert_eq!(value(c.claim(KEY_A.into(), amaka())), 0);
    assert!(get_created_receipts().is_empty());
}

#[test]
fn double_claim_pays_once() {
    let mut c = setup();
    hold(&mut c, alice(), 100, KEY_A, 60);
    let first = claim(&mut c, KEY_A, amaka());

    // A second claim while the first transfer is in flight finds nothing.
    ctx(oracle(), T0);
    assert_eq!(value(c.claim(KEY_A.into(), acc("mallory.testnet"))), 0);
    assert!(get_created_receipts().is_empty());

    assert_eq!(resolve_claim(&mut c, &first, vec![ok()]), 1);
    ctx(oracle(), T0);
    assert_eq!(value(c.claim(KEY_A.into(), amaka())), 0);
}

#[test]
fn expired_payment_is_still_claimable() {
    let mut c = setup();
    hold(&mut c, alice(), 100, KEY_A, 60);
    ctx(oracle(), T0 + 3600 * SEC);
    drop(promise(c.claim(KEY_A.into(), amaka())));
    let calls = scheduled();
    assert_eq!(resolve_claim(&mut c, &calls, vec![ok()]), 1);
}

#[test]
fn failed_claim_transfer_restores_payments() {
    let mut c = setup();
    hold(&mut c, alice(), 100, KEY_A, 60);
    hold(&mut c, bob(), 250, KEY_A, 60);
    let before = c.pending(KEY_A.into());

    let calls = claim(&mut c, KEY_A, amaka());
    assert!(c.pending(KEY_A.into()).is_empty());
    // e.g. amaka is not registered with the token yet.
    assert_eq!(
        resolve_claim(&mut c, &calls, vec![PromiseResult::Failed]),
        0
    );

    assert_eq!(c.pending(KEY_A.into()), before);
    assert!(events("claim").is_empty());
    let failed = &events("claim_failed")[0][0];
    assert_eq!(failed["ids"], json!(["0", "1"]));
    assert_eq!(failed["amount"], "350");

    // Restored payments can be claimed again, and refunded once expired.
    let retry = claim(&mut c, KEY_A, amaka());
    assert_eq!(resolve_claim(&mut c, &retry, vec![ok()]), 2);
}

#[test]
fn restored_payments_merge_with_holds_made_meanwhile() {
    let mut c = setup();
    hold(&mut c, alice(), 100, KEY_A, 60);
    let calls = claim(&mut c, KEY_A, amaka());
    hold(&mut c, bob(), 200, KEY_A, 60);
    assert_eq!(pending_ids(&c, KEY_A), vec![1]);
    resolve_claim(&mut c, &calls, vec![PromiseResult::Failed]);
    assert_eq!(pending_ids(&c, KEY_A), vec![0, 1]);
}

#[test]
fn claim_with_two_tokens_restores_only_the_failed_one() {
    let mut c = setup();
    as_owner();
    c.add_token(eurc());
    hold(&mut c, alice(), 100, KEY_A, 60);
    let msg = json!({"kind": "hold", "recipient": KEY_A, "lifetime_secs": 60});
    send(&mut c, eurc(), bob(), 70, msg);

    let calls = claim(&mut c, KEY_A, amaka());
    let transfers: Vec<&Call> = calls.iter().filter(|c| c.method == "ft_transfer").collect();
    assert_eq!(transfers.len(), 2);
    let callback = calls
        .iter()
        .find(|c| c.method == "on_claim_resolved")
        .unwrap();
    assert_eq!(
        callback.gas,
        CALLBACK_GAS.saturating_add(RESTORE_GAS_PER_PAYMENT.saturating_mul(2))
    );

    // Groups go out in account-id order: eurc.testnet, then usdc.testnet.
    assert_eq!(transfers[0].receiver, eurc());
    assert_eq!(transfers[1].receiver, usdc());
    assert_eq!(
        resolve_claim(&mut c, &calls, vec![PromiseResult::Failed, ok()]),
        1
    );

    let still = c.pending(KEY_A.into());
    assert_eq!(still.len(), 1);
    assert_eq!(still[0].token, eurc());
    assert_eq!(events("claim")[0][0]["token"], "usdc.testnet");
    assert_eq!(events("claim_failed")[0][0]["token"], "eurc.testnet");
}

#[test]
fn claim_releases_at_most_one_batch() {
    let mut c = setup();
    let extra = 7;
    for _ in 0..MAX_CLAIM_BATCH + extra {
        hold(&mut c, alice(), 1, KEY_A, 60);
    }
    let first = claim(&mut c, KEY_A, amaka());
    assert_eq!(first[0].args["amount"], MAX_CLAIM_BATCH.to_string());
    assert_eq!(c.pending(KEY_A.into()).len(), extra);
    assert_eq!(
        resolve_claim(&mut c, &first, vec![ok()]),
        MAX_CLAIM_BATCH as u32
    );

    let second = claim(&mut c, KEY_A, amaka());
    assert_eq!(resolve_claim(&mut c, &second, vec![ok()]), extra as u32);
    assert!(c.pending(KEY_A.into()).is_empty());
}

#[test]
#[should_panic(expected = "not enough gas")]
fn claim_without_gas_for_its_callback_fails() {
    let mut c = setup();
    hold(&mut c, alice(), 100, KEY_A, 60);
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(escrow())
            .predecessor_account_id(oracle())
            .block_timestamp(T0)
            .prepaid_gas(Gas::from_tgas(20))
            .build()
    );
    let _ = c.claim(KEY_A.into(), amaka());
}

// ---- refunding -------------------------------------------------------------

#[test]
fn refund_after_expiry_pays_the_sender() {
    let mut c = setup();
    hold(&mut c, alice(), 100, KEY_A, 60);
    let calls = refund(&mut c, alice(), 0, T0 + 60 * SEC);
    assert!(c.get_payment(U64(0)).is_none());
    assert!(c.pending(KEY_A.into()).is_empty());

    let transfer = &calls[0];
    assert_eq!(transfer.receiver, usdc());
    assert_eq!(transfer.method, "ft_transfer");
    assert_eq!(transfer.args["receiver_id"], "alice.testnet");
    assert_eq!(transfer.args["amount"], "100");
    assert_eq!(transfer.deposit, NearToken::from_yoctonear(1));
    assert!(resolve_refund(&mut c, &calls, ok()));
    assert_eq!(events("refund").len(), 1);
}

#[test]
#[should_panic(expected = "this payment has not expired yet")]
fn refund_before_expiry_fails() {
    let mut c = setup();
    hold(&mut c, alice(), 100, KEY_A, 60);
    refund(&mut c, alice(), 0, T0 + 60 * SEC - 1);
}

#[test]
#[should_panic(expected = "only the sender can refund")]
fn refund_by_non_sender_fails() {
    let mut c = setup();
    hold(&mut c, alice(), 100, KEY_A, 60);
    refund(&mut c, bob(), 0, T0 + 61 * SEC);
}

#[test]
#[should_panic(expected = "no pending payment with this id")]
fn claim_then_refund_fails() {
    let mut c = setup();
    hold(&mut c, alice(), 100, KEY_A, 60);
    let calls = claim(&mut c, KEY_A, amaka());
    resolve_claim(&mut c, &calls, vec![ok()]);
    refund(&mut c, alice(), 0, T0 + 61 * SEC);
}

#[test]
#[should_panic(expected = "no pending payment with this id")]
fn refund_during_an_in_flight_claim_fails() {
    let mut c = setup();
    hold(&mut c, alice(), 100, KEY_A, 60);
    let _calls = claim(&mut c, KEY_A, amaka());
    refund(&mut c, alice(), 0, T0 + 61 * SEC);
}

#[test]
fn refund_then_claim_releases_nothing() {
    let mut c = setup();
    hold(&mut c, alice(), 100, KEY_A, 60);
    let calls = refund(&mut c, alice(), 0, T0 + 61 * SEC);

    // Claim while the refund is in flight, and again after it lands.
    ctx(oracle(), T0 + 61 * SEC);
    assert_eq!(value(c.claim(KEY_A.into(), amaka())), 0);
    assert!(resolve_refund(&mut c, &calls, ok()));
    ctx(oracle(), T0 + 62 * SEC);
    assert_eq!(value(c.claim(KEY_A.into(), amaka())), 0);
}

#[test]
fn failed_refund_transfer_restores_the_payment() {
    let mut c = setup();
    hold(&mut c, alice(), 100, KEY_A, 60);
    hold(&mut c, bob(), 5, KEY_A, 60);
    let before = c.get_payment(U64(0)).unwrap();
    let calls = refund(&mut c, alice(), 0, T0 + 61 * SEC);

    assert!(!resolve_refund(&mut c, &calls, PromiseResult::Failed));
    assert_eq!(c.get_payment(U64(0)), Some(before));
    assert_eq!(pending_ids(&c, KEY_A), vec![0, 1]);
    assert!(events("refund").is_empty());
    assert_eq!(events("refund_failed")[0][0]["id"], "0");

    // It can still be refunded, or claimed.
    let retry = refund(&mut c, alice(), 0, T0 + 62 * SEC);
    assert!(resolve_refund(&mut c, &retry, ok()));
}

// ---- events ----------------------------------------------------------------

#[test]
fn events_have_the_documented_shape() {
    let mut c = setup();
    hold(&mut c, alice(), 1_500_000, KEY_A, 60);
    assert_eq!(
        events("hold"),
        vec![json!([{
            "id": "0",
            "sender": "alice.testnet",
            "token": "usdc.testnet",
            "amount": "1500000",
            "recipient": KEY_A,
            "expiry_ns": (T0 + 60 * SEC).to_string(),
        }])]
    );
    let raw = get_logs()
        .into_iter()
        .find(|l| l.starts_with("EVENT_JSON:"))
        .unwrap();
    let raw: Value = serde_json::from_str(raw.strip_prefix("EVENT_JSON:").unwrap()).unwrap();
    assert_eq!(
        raw.as_object().unwrap().len(),
        4,
        "standard, version, event, data"
    );

    let calls = claim(&mut c, KEY_A, amaka());
    resolve_claim(&mut c, &calls, vec![ok()]);
    assert_eq!(
        events("claim"),
        vec![json!([{
            "recipient": KEY_A,
            "account_id": "amaka.testnet",
            "token": "usdc.testnet",
            "amount": "1500000",
            "ids": ["0"],
        }])]
    );

    hold(&mut c, bob(), 42, KEY_B, 60);
    let calls = claim(&mut c, KEY_B, amaka());
    resolve_claim(&mut c, &calls, vec![PromiseResult::Failed]);
    assert_eq!(
        events("claim_failed"),
        vec![json!([{
            "recipient": KEY_B,
            "account_id": "amaka.testnet",
            "token": "usdc.testnet",
            "amount": "42",
            "ids": ["1"],
        }])]
    );

    let calls = refund(&mut c, bob(), 1, T0 + 60 * SEC);
    resolve_refund(&mut c, &calls, ok());
    assert_eq!(
        events("refund"),
        vec![
            json!([{"id": "1", "sender": "bob.testnet", "token": "usdc.testnet", "amount": "42"}])
        ]
    );

    hold(&mut c, bob(), 9, KEY_B, 60);
    let calls = refund(&mut c, bob(), 2, T0 + 60 * SEC);
    resolve_refund(&mut c, &calls, PromiseResult::Failed);
    assert_eq!(
        events("refund_failed"),
        vec![json!([{"id": "2", "sender": "bob.testnet", "token": "usdc.testnet", "amount": "9"}])]
    );
}

// ---- views and owner -------------------------------------------------------

#[test]
fn config_and_views_use_string_numbers() {
    let mut c = setup();
    assert_eq!(
        serde_json::to_value(c.get_config()).unwrap(),
        json!({
            "owner": "owner.testnet",
            "oracle": "oracle.testnet",
            "tokens": ["usdc.testnet"],
            "max_lifetime_secs": MAX_LIFETIME,
            "min_hold": {"usdc.testnet": "0"},
        })
    );
    hold(&mut c, alice(), 7, KEY_A, 60);
    let view = serde_json::to_value(c.get_payment(U64(0))).unwrap();
    assert_eq!(view["id"], "0");
    assert_eq!(view["amount"], "7");
    assert_eq!(view["expiry_ns"], (T0 + 60 * SEC).to_string());
    assert_eq!(c.get_payment(U64(99)), None);
}

#[test]
fn owner_rotates_the_oracle_and_edits_tokens() {
    let mut c = setup();
    hold(&mut c, alice(), 100, KEY_A, 60);

    as_owner();
    c.set_oracle(acc("oracle2.testnet"));
    c.remove_token(usdc());
    assert_eq!(c.get_config().oracle, acc("oracle2.testnet"));
    assert!(c.get_config().tokens.is_empty());

    // New holds in a removed token bounce...
    assert_eq!(hold(&mut c, alice(), 100, KEY_A, 60), 100);
    // ...but money already held in it can still be claimed, by the new oracle.
    ctx(acc("oracle2.testnet"), T0);
    drop(promise(c.claim(KEY_A.into(), amaka())));
    assert_eq!(scheduled()[0].receiver, usdc());
}

#[test]
#[should_panic(expected = "only the owner can do this")]
fn non_owner_cannot_set_the_oracle() {
    let mut c = setup();
    ctx_paying(oracle(), NearToken::from_yoctonear(1));
    c.set_oracle(alice());
}

#[test]
#[should_panic(expected = "only the owner can do this")]
fn non_owner_cannot_add_a_token() {
    let mut c = setup();
    ctx_paying(alice(), NearToken::from_yoctonear(1));
    c.add_token(acc("fake-usdc.testnet"));
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn owner_methods_need_one_yocto_so_a_limited_key_cannot_call_them() {
    // A function-call key cannot attach a deposit; this is what it would send.
    let mut c = setup();
    ctx(owner(), T0);
    c.set_oracle(alice());
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn owner_methods_refuse_more_than_one_yocto() {
    let mut c = setup();
    ctx_paying(owner(), NearToken::from_yoctonear(2));
    c.add_token(eurc());
}

#[test]
#[should_panic(expected = "only the owner can do this")]
fn non_owner_cannot_set_the_minimum() {
    let mut c = setup();
    ctx_paying(alice(), NearToken::from_yoctonear(1));
    c.set_min_hold(usdc(), U128(0));
}

#[test]
fn holds_below_the_minimum_are_refunded_whole() {
    let mut c = setup();
    as_owner();
    c.set_min_hold(usdc(), U128(10_000));
    assert_eq!(c.get_config().min_hold[&usdc()], U128(10_000));

    // A single hold under the floor bounces, in full.
    assert_eq!(hold(&mut c, alice(), 9_999, KEY_A, 60), 9_999);
    assert!(c.pending(KEY_A.into()).is_empty());
    assert!(get_logs().iter().any(|l| l.contains("below the minimum hold")));

    // One small item sinks a hold_many: nothing is created, all of it goes back.
    let msg = json!({"kind": "hold_many", "lifetime_secs": 60, "items": [
        {"recipient": KEY_A, "amount": "50000"},
        {"recipient": KEY_B, "amount": "5"},
    ]});
    assert_eq!(send(&mut c, usdc(), alice(), 50_005, msg), 50_005);
    assert!(c.pending(KEY_A.into()).is_empty());
    assert!(c.pending(KEY_B.into()).is_empty());

    // At the floor is fine.
    assert_eq!(hold(&mut c, alice(), 10_000, KEY_A, 60), 0);
    assert_eq!(pending_ids(&c, KEY_A), vec![0]);
}

#[test]
fn the_minimum_is_per_token_and_can_be_turned_off() {
    let mut c = setup();
    as_owner();
    c.add_token(eurc());
    c.set_min_hold(usdc(), U128(10_000));

    // EURC has no floor of its own.
    let msg = json!({"kind": "hold", "recipient": KEY_A, "lifetime_secs": 60});
    assert_eq!(send(&mut c, eurc(), bob(), 1, msg), 0);

    as_owner();
    c.set_min_hold(usdc(), U128(0));
    assert_eq!(hold(&mut c, alice(), 1, KEY_B, 60), 0);
}

#[test]
#[should_panic(expected = "max_lifetime_secs must be positive")]
fn zero_max_lifetime_is_rejected() {
    ctx(escrow(), T0);
    HandleEscrow::new(owner(), oracle(), vec![usdc()], 0);
}
