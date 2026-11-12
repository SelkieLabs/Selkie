//! Unit tests against near-sdk's mocked blockchain. Payouts are checked end to
//! end: the receipts a send or withdraw schedules are decoded, and the
//! callback is then called with exactly those arguments under a success or a
//! failure promise result, the way the chain would call it.

use super::*;
use near_sdk::mock::MockAction;
use near_sdk::serde::Deserialize;
use near_sdk::serde_json::{self, Value, json};
use near_sdk::test_utils::{VMContextBuilder, get_created_receipts, get_logs};
use near_sdk::{PromiseResult, RuntimeFeesConfig, test_vm_config, testing_env};

const DAY: u64 = NS_PER_DAY;
/// Block time of most calls: noon of some UTC day.
const T0: u64 = 20_000 * DAY + DAY / 2;
const USDC: u128 = 1_000_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn pocket_id() -> AccountId {
    acc("pocket.selkiepay.testnet")
}
fn admin() -> AccountId {
    acc("selkiepay.testnet")
}
fn bot() -> AccountId {
    acc("pocketbot.selkiepay.testnet")
}
fn usdc() -> AccountId {
    acc("usdc.testnet")
}
fn parent() -> AccountId {
    acc("x.selkiepay.testnet")
}
/// A pocket owner who is also on Selkie.
fn tunde() -> AccountId {
    acc("tunde.x.selkiepay.testnet")
}
fn amaka() -> AccountId {
    acc("amaka.x.selkiepay.testnet")
}

fn context(predecessor: AccountId, now: u64) -> VMContextBuilder {
    let mut builder = VMContextBuilder::new();
    builder
        .current_account_id(pocket_id())
        .predecessor_account_id(predecessor)
        .block_timestamp(now)
        .prepaid_gas(Gas::from_tgas(100));
    builder
}

fn ctx(predecessor: AccountId, now: u64) {
    testing_env!(context(predecessor, now).build());
}

fn ctx_paying(predecessor: AccountId, deposit: NearToken) {
    testing_env!(context(predecessor, T0).attached_deposit(deposit).build());
}

fn one_yocto(predecessor: AccountId) {
    ctx_paying(predecessor, NearToken::from_yoctonear(1));
}

fn callback_ctx(now: u64, result: PromiseResult) {
    testing_env!(
        context(pocket_id(), now).build(),
        test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result]
    );
}

fn setup() -> SelkiePocket {
    ctx(pocket_id(), T0);
    SelkiePocket::new(admin(), bot(), usdc(), parent())
}

/// Send `amount` of `token` from `sender` with `msg`; returns what the token
/// must refund.
fn transfer(
    c: &mut SelkiePocket,
    token: AccountId,
    sender: AccountId,
    amount: u128,
    msg: Value,
) -> u128 {
    ctx(token, T0);
    c.ft_on_transfer(sender, U128(amount), msg.to_string()).0
}

fn top_up(c: &mut SelkiePocket, owner: AccountId, amount: u128, cap: Option<u128>) {
    let msg = match cap {
        Some(cap) => json!({"kind": "top_up", "daily_cap": cap.to_string()}),
        None => json!({"kind": "top_up"}),
    };
    assert_eq!(transfer(c, usdc(), owner, amount, msg), 0);
}

fn pocket(c: &SelkiePocket, owner: AccountId) -> PocketView {
    c.get_pocket(owner).expect("pocket exists")
}

#[derive(Debug)]
struct Call {
    receiver: AccountId,
    method: String,
    args: Value,
    deposit: NearToken,
    gas: Gas,
}

fn scheduled() -> Vec<Call> {
    let mut calls = Vec::new();
    for receipt in get_created_receipts() {
        for action in receipt.actions {
            if let MockAction::FunctionCallWeight {
                method_name,
                args,
                attached_deposit,
                prepaid_gas,
                ..
            } = action
            {
                calls.push(Call {
                    receiver: receipt.receiver_id.clone(),
                    method: String::from_utf8(method_name).unwrap(),
                    args: serde_json::from_slice(&args).unwrap(),
                    deposit: attached_deposit,
                    gas: prepaid_gas,
                });
            }
        }
    }
    calls
}

/// The bot sends at `now`; returns the scheduled transfer and callback.
fn send_at(
    c: &mut SelkiePocket,
    owner: AccountId,
    to: AccountId,
    amount: u128,
    now: u64,
) -> Vec<Call> {
    ctx(bot(), now);
    drop(c.pocket_send(owner, to, U128(amount), None));
    scheduled()
}

fn send(c: &mut SelkiePocket, owner: AccountId, to: AccountId, amount: u128) -> Vec<Call> {
    send_at(c, owner, to, amount, T0)
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct SendCallback {
    owner: AccountId,
    to: AccountId,
    amount: U128,
    day: u64,
}

fn resolve_send(c: &mut SelkiePocket, calls: &[Call], now: u64, result: PromiseResult) -> bool {
    let cb = calls
        .iter()
        .find(|call| call.method == "on_send_resolved")
        .expect("callback scheduled");
    let args: SendCallback = serde_json::from_value(cb.args.clone()).unwrap();
    callback_ctx(now, result);
    c.on_send_resolved(args.owner, args.to, args.amount, args.day)
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct WithdrawCallback {
    owner: AccountId,
    amount: U128,
}

fn resolve_withdraw(c: &mut SelkiePocket, calls: &[Call], result: PromiseResult) -> bool {
    let cb = calls
        .iter()
        .find(|call| call.method == "on_withdraw_resolved")
        .expect("callback scheduled");
    let args: WithdrawCallback = serde_json::from_value(cb.args.clone()).unwrap();
    callback_ctx(T0, result);
    c.on_withdraw_resolved(args.owner, args.amount)
}

fn ok() -> PromiseResult {
    PromiseResult::Successful(vec![])
}

fn events(name: &str) -> Vec<Value> {
    get_logs()
        .iter()
        .filter_map(|log| log.strip_prefix("EVENT_JSON:"))
        .map(|body| serde_json::from_str::<Value>(body).unwrap())
        .filter(|e| e["event"] == name)
        .map(|e| {
            assert_eq!(e["standard"], "selkie-pocket");
            assert_eq!(e["version"], "1.0.0");
            e["data"].clone()
        })
        .collect()
}

fn view(balance: u128, cap: u128, spent: u128, left: u128) -> PocketView {
    PocketView {
        balance: U128(balance),
        daily_cap: U128(cap),
        spent_today: U128(spent),
        left_today: U128(left),
    }
}

// ---- top up ------------------------------------------------------------------

#[test]
fn top_up_credits_a_new_pocket_with_the_default_cap() {
    let mut c = setup();
    assert!(c.get_pocket(tunde()).is_none());
    top_up(&mut c, tunde(), 5 * USDC, None);
    assert_eq!(
        pocket(&c, tunde()),
        view(5 * USDC, DEFAULT_DAILY_CAP, 0, 5 * USDC)
    );
    assert_eq!(
        events("top_up"),
        vec![
            json!([{"owner": tunde(), "amount": "5000000", "balance": "5000000", "daily_cap": "10000000"}])
        ]
    );

    top_up(&mut c, tunde(), 2 * USDC, None);
    assert_eq!(pocket(&c, tunde()).balance, U128(7 * USDC));
}

#[test]
fn top_up_with_a_cap_sets_it_and_a_later_top_up_can_change_it() {
    let mut c = setup();
    top_up(&mut c, tunde(), 20 * USDC, Some(3 * USDC));
    assert_eq!(pocket(&c, tunde()), view(20 * USDC, 3 * USDC, 0, 3 * USDC));
    top_up(&mut c, tunde(), USDC, Some(0));
    assert_eq!(pocket(&c, tunde()), view(21 * USDC, 0, 0, 0));
    // A top-up without a cap keeps the one already set.
    top_up(&mut c, tunde(), USDC, None);
    assert_eq!(pocket(&c, tunde()).daily_cap, U128(0));
}

#[test]
#[should_panic(expected = "only the pocket's token can top up")]
fn top_up_from_another_token_panics() {
    let mut c = setup();
    transfer(
        &mut c,
        acc("fake-usdc.testnet"),
        tunde(),
        USDC,
        json!({"kind": "top_up"}),
    );
}

#[test]
fn a_bad_msg_is_refunded_in_full_and_creates_nothing() {
    let mut c = setup();
    for msg in [
        json!("not json"),
        json!({}),
        json!({"kind": "hold", "recipient": "ab", "lifetime_secs": 60}),
        json!({"kind": "top_up", "daily_cap": 5}),
        json!({"kind": "top_up", "daily_cap": "-1"}),
        json!({"kind": "top_up", "extra": true}),
    ] {
        assert_eq!(
            transfer(&mut c, usdc(), tunde(), USDC, msg.clone()),
            USDC,
            "{msg}"
        );
    }
    ctx(usdc(), T0);
    assert_eq!(
        c.ft_on_transfer(tunde(), U128(USDC), "{\"kind\":".into()).0,
        USDC
    );
    assert!(c.get_pocket(tunde()).is_none());
    assert!(events("top_up").is_empty());
}

#[test]
fn a_new_pocket_is_refused_when_the_contract_is_low_on_near() {
    let mut c = setup();
    testing_env!(
        context(usdc(), T0)
            .account_balance(NearToken::from_millinear(100))
            .build()
    );
    let refunded = c.ft_on_transfer(tunde(), U128(USDC), json!({"kind": "top_up"}).to_string());
    assert_eq!(refunded.0, USDC);
    assert!(c.get_pocket(tunde()).is_none());
}

// ---- send ------------------------------------------------------------------

#[test]
fn send_within_the_cap_pays_the_handle_account() {
    let mut c = setup();
    top_up(&mut c, tunde(), USDC, Some(USDC / 2));

    let calls = send(&mut c, tunde(), amaka(), 200_000);
    assert_eq!(calls.len(), 2);
    let transfer = &calls[0];
    assert_eq!(transfer.receiver, usdc());
    assert_eq!(transfer.method, "ft_transfer");
    assert_eq!(
        transfer.args,
        json!({"receiver_id": amaka(), "amount": "200000", "memo": "Selkie pocket"})
    );
    assert_eq!(transfer.deposit, NearToken::from_yoctonear(1));
    assert_eq!(transfer.gas, FT_TRANSFER_GAS);
    assert_eq!(calls[1].receiver, pocket_id());
    assert!(calls[1].gas >= CALLBACK_GAS);

    // Out of the pocket before the transfer resolves.
    assert_eq!(
        pocket(&c, tunde()),
        view(800_000, 500_000, 200_000, 300_000)
    );

    assert!(resolve_send(&mut c, &calls, T0, ok()));
    assert_eq!(
        events("send"),
        vec![json!([{"owner": tunde(), "to": amaka(), "amount": "200000"}])]
    );
    assert_eq!(
        pocket(&c, tunde()),
        view(800_000, 500_000, 200_000, 300_000)
    );
}

#[test]
fn the_bots_memo_is_passed_through() {
    let mut c = setup();
    top_up(&mut c, tunde(), USDC, None);
    ctx(bot(), T0);
    drop(c.pocket_send(tunde(), amaka(), U128(1), Some("for lunch".into())));
    assert_eq!(scheduled()[0].args["memo"], "for lunch");
}

#[test]
#[should_panic(expected = "over the pocket's daily cap")]
fn send_over_the_cap_fails() {
    let mut c = setup();
    top_up(&mut c, tunde(), USDC, Some(USDC / 2));
    send(&mut c, tunde(), amaka(), 300_000);
    send(&mut c, tunde(), amaka(), 200_001);
}

#[test]
#[should_panic(expected = "over the pocket's daily cap")]
fn a_zero_cap_stops_the_bot() {
    let mut c = setup();
    top_up(&mut c, tunde(), USDC, Some(0));
    send(&mut c, tunde(), amaka(), 1);
}

#[test]
#[should_panic(expected = "not enough in the pocket")]
fn send_over_the_balance_fails() {
    let mut c = setup();
    top_up(&mut c, tunde(), USDC, None);
    send(&mut c, tunde(), amaka(), USDC + 1);
}

#[test]
fn the_cap_resets_on_the_next_utc_day() {
    let mut c = setup();
    top_up(&mut c, tunde(), 3 * USDC, Some(USDC));
    send(&mut c, tunde(), amaka(), USDC);
    assert_eq!(pocket(&c, tunde()).left_today, U128(0));

    // One second past midnight UTC.
    let tomorrow = (T0 / DAY + 1) * DAY + 1_000_000_000;
    ctx(bot(), tomorrow);
    assert_eq!(pocket(&c, tunde()), view(2 * USDC, USDC, 0, USDC));
    send_at(&mut c, tunde(), amaka(), USDC, tomorrow);
    assert_eq!(pocket(&c, tunde()), view(USDC, USDC, USDC, 0));
}

#[test]
#[should_panic(expected = "only the bot can send from a pocket")]
fn only_the_bot_can_send() {
    let mut c = setup();
    top_up(&mut c, tunde(), USDC, None);
    ctx(amaka(), T0);
    drop(c.pocket_send(tunde(), amaka(), U128(1), None));
}

#[test]
#[should_panic(expected = "only the bot can send from a pocket")]
fn the_owner_cannot_call_send_either() {
    let mut c = setup();
    top_up(&mut c, tunde(), USDC, None);
    ctx(admin(), T0);
    drop(c.pocket_send(tunde(), amaka(), U128(1), None));
}

#[test]
fn send_only_reaches_direct_children_of_the_handle_parent() {
    for to in [
        "evil.testnet",
        "a.b.x.selkiepay.testnet",
        "x.selkiepay.testnet",
        "pocket.selkiepay.testnet",
        "amakax.selkiepay.testnet",
        "amaka.x.selkiepay.testnet.evil.testnet",
    ] {
        let result = std::panic::catch_unwind(|| {
            let mut c = setup();
            top_up(&mut c, tunde(), USDC, None);
            send(&mut c, tunde(), acc(to), 1);
        });
        assert!(result.is_err(), "{to} should be refused");
    }
}

#[test]
#[should_panic(expected = "can only send to a Selkie handle account")]
fn send_to_a_non_handle_account_says_why() {
    let mut c = setup();
    top_up(&mut c, tunde(), USDC, None);
    send(&mut c, tunde(), acc("evil.testnet"), 1);
}

#[test]
#[should_panic(expected = "cannot send a pocket to its owner")]
fn send_to_the_owner_fails() {
    let mut c = setup();
    top_up(&mut c, tunde(), USDC, None);
    send(&mut c, tunde(), tunde(), 1);
}

#[test]
#[should_panic(expected = "amount must be more than zero")]
fn send_of_zero_fails() {
    let mut c = setup();
    top_up(&mut c, tunde(), USDC, None);
    send(&mut c, tunde(), amaka(), 0);
}

#[test]
#[should_panic(expected = "no pocket for this account")]
fn send_from_no_pocket_fails() {
    let mut c = setup();
    send(&mut c, tunde(), amaka(), 1);
}

#[test]
#[should_panic(expected = "not enough gas")]
fn send_needs_gas_for_its_callback() {
    let mut c = setup();
    top_up(&mut c, tunde(), USDC, None);
    testing_env!(context(bot(), T0).prepaid_gas(Gas::from_tgas(20)).build());
    drop(c.pocket_send(tunde(), amaka(), U128(1), None));
}

#[test]
fn a_failed_transfer_restores_the_balance_and_todays_spend() {
    let mut c = setup();
    top_up(&mut c, tunde(), USDC, Some(USDC / 2));
    let calls = send(&mut c, tunde(), amaka(), 400_000);
    assert_eq!(
        pocket(&c, tunde()),
        view(600_000, 500_000, 400_000, 100_000)
    );

    assert!(!resolve_send(&mut c, &calls, T0, PromiseResult::Failed));
    assert_eq!(pocket(&c, tunde()), view(USDC, 500_000, 0, 500_000));
    assert!(events("send").is_empty());
    assert_eq!(
        events("send_failed"),
        vec![json!([{"owner": tunde(), "to": amaka(), "amount": "400000"}])]
    );
}

#[test]
fn a_transfer_failing_after_midnight_restores_only_the_balance() {
    let mut c = setup();
    top_up(&mut c, tunde(), USDC, Some(USDC));
    let calls = send(&mut c, tunde(), amaka(), 400_000);
    // A send early the next day rolls the pocket's day over...
    let tomorrow = (T0 / DAY + 1) * DAY + 1;
    send_at(&mut c, tunde(), amaka(), 100_000, tomorrow);
    // ...then yesterday's transfer comes back failed: today's spend is untouched.
    resolve_send(&mut c, &calls, tomorrow, PromiseResult::Failed);
    ctx(bot(), tomorrow);
    assert_eq!(pocket(&c, tunde()), view(900_000, USDC, 100_000, 900_000));
}

// ---- withdraw ----------------------------------------------------------------

#[test]
fn withdraw_everything_or_an_amount_back_to_the_owner() {
    let mut c = setup();
    top_up(&mut c, tunde(), 5 * USDC, None);

    one_yocto(tunde());
    drop(c.pocket_withdraw(Some(U128(2 * USDC))));
    let calls = scheduled();
    assert_eq!(calls[0].receiver, usdc());
    assert_eq!(calls[0].method, "ft_transfer");
    assert_eq!(calls[0].args["receiver_id"], json!(tunde()));
    assert_eq!(calls[0].args["amount"], "2000000");
    assert_eq!(calls[0].deposit, NearToken::from_yoctonear(1));
    assert!(resolve_withdraw(&mut c, &calls, ok()));
    assert_eq!(
        events("withdraw"),
        vec![json!([{"owner": tunde(), "amount": "2000000"}])]
    );
    assert_eq!(pocket(&c, tunde()).balance, U128(3 * USDC));

    one_yocto(tunde());
    drop(c.pocket_withdraw(None));
    let calls = scheduled();
    assert_eq!(calls[0].args["amount"], "3000000");
    assert!(resolve_withdraw(&mut c, &calls, ok()));
    assert_eq!(pocket(&c, tunde()).balance, U128(0));
}

#[test]
fn a_failed_withdraw_restores_the_balance() {
    let mut c = setup();
    top_up(&mut c, tunde(), 5 * USDC, None);
    one_yocto(tunde());
    drop(c.pocket_withdraw(None));
    let calls = scheduled();
    assert_eq!(pocket(&c, tunde()).balance, U128(0));
    assert!(!resolve_withdraw(&mut c, &calls, PromiseResult::Failed));
    assert_eq!(pocket(&c, tunde()).balance, U128(5 * USDC));
    assert_eq!(
        events("withdraw_failed"),
        vec![json!([{"owner": tunde(), "amount": "5000000"}])]
    );
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn withdraw_needs_one_yocto() {
    let mut c = setup();
    top_up(&mut c, tunde(), USDC, None);
    ctx(tunde(), T0);
    drop(c.pocket_withdraw(None));
}

#[test]
#[should_panic(expected = "no pocket for this account")]
fn only_the_owner_withdraws_their_pocket() {
    let mut c = setup();
    top_up(&mut c, tunde(), USDC, None);
    // The bot (or anyone else) withdrawing gets their own pocket, which is none.
    one_yocto(bot());
    drop(c.pocket_withdraw(None));
}

#[test]
#[should_panic(expected = "not enough in the pocket")]
fn withdraw_over_the_balance_fails() {
    let mut c = setup();
    top_up(&mut c, tunde(), USDC, None);
    one_yocto(tunde());
    drop(c.pocket_withdraw(Some(U128(USDC + 1))));
}

#[test]
#[should_panic(expected = "nothing to withdraw")]
fn withdraw_from_an_empty_pocket_fails() {
    let mut c = setup();
    top_up(&mut c, tunde(), USDC, None);
    one_yocto(tunde());
    drop(c.pocket_withdraw(None));
    one_yocto(tunde());
    drop(c.pocket_withdraw(None));
}

// ---- cap and admin -----------------------------------------------------------

#[test]
fn set_cap_changes_the_limit_for_today_too() {
    let mut c = setup();
    top_up(&mut c, tunde(), 5 * USDC, None);
    send(&mut c, tunde(), amaka(), USDC);
    one_yocto(tunde());
    c.pocket_set_cap(U128(3 * USDC));
    assert_eq!(
        events("cap"),
        vec![json!([{"owner": tunde(), "daily_cap": "3000000"}])]
    );
    assert_eq!(
        pocket(&c, tunde()),
        view(4 * USDC, 3 * USDC, USDC, 2 * USDC)
    );
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn set_cap_needs_one_yocto() {
    let mut c = setup();
    top_up(&mut c, tunde(), USDC, None);
    ctx(tunde(), T0);
    c.pocket_set_cap(U128(1));
}

#[test]
#[should_panic(expected = "no pocket for this account")]
fn set_cap_needs_a_pocket() {
    let mut c = setup();
    one_yocto(tunde());
    c.pocket_set_cap(U128(1));
}

#[test]
fn left_today_is_never_more_than_the_balance() {
    let mut c = setup();
    top_up(&mut c, tunde(), 2 * USDC, Some(50 * USDC));
    assert_eq!(pocket(&c, tunde()).left_today, U128(2 * USDC));
}

#[test]
fn config_and_set_bot() {
    let mut c = setup();
    assert_eq!(
        c.get_config(),
        ConfigView {
            owner: admin(),
            bot: bot(),
            token: usdc(),
            handle_parent: parent()
        }
    );
    one_yocto(admin());
    c.set_bot(acc("bot2.selkiepay.testnet"));
    assert_eq!(c.get_config().bot, acc("bot2.selkiepay.testnet"));
}

#[test]
#[should_panic(expected = "only the owner can do this")]
fn only_the_owner_sets_the_bot() {
    let mut c = setup();
    one_yocto(bot());
    c.set_bot(bot());
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn set_bot_needs_one_yocto() {
    let mut c = setup();
    ctx(admin(), T0);
    c.set_bot(bot());
}
