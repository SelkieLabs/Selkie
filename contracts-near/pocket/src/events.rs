//! NEP-297 events (`EVENT_JSON:{...}` logs) under the `selkie-pocket`
//! standard. Readers link a tweet's send to its transfer through these, so
//! their shape is part of the contract's interface.

use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::{AccountId, env, serde_json};

const STANDARD: &str = "selkie-pocket";
const VERSION: &str = "1.0.0";

/// `top_up`: money arrived; `balance` and `daily_cap` are the pocket after it.
#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct TopUpData<'a> {
    pub owner: &'a AccountId,
    pub amount: U128,
    pub balance: U128,
    pub daily_cap: U128,
}

/// `send` / `send_failed`: the bot paid `to` from `owner`'s pocket, or the
/// transfer failed and the pocket was restored.
#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct SendData<'a> {
    pub owner: &'a AccountId,
    pub to: &'a AccountId,
    pub amount: U128,
}

/// `withdraw` / `withdraw_failed`.
#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct WithdrawData<'a> {
    pub owner: &'a AccountId,
    pub amount: U128,
}

/// `cap`: the owner changed their daily cap.
#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct CapData<'a> {
    pub owner: &'a AccountId,
    pub daily_cap: U128,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct Event<'a, T: Serialize> {
    standard: &'static str,
    version: &'static str,
    event: &'a str,
    data: &'a [T],
}

/// Log `event` with `data`. Never panics: it runs inside callbacks, where a
/// panic would skip putting a failed transfer's money back.
pub fn emit<T: Serialize>(event: &str, data: &[T]) {
    let body = Event {
        standard: STANDARD,
        version: VERSION,
        event,
        data,
    };
    if let Ok(json) = serde_json::to_string(&body) {
        env::log_str(&format!("EVENT_JSON:{json}"));
    }
}
