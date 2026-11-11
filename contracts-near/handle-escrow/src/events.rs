//! NEP-297 events (`EVENT_JSON:{...}` logs). The backend and indexers read
//! these to link a send to its later claim or refund, so their shape is part
//! of the contract's interface: change it only together with the readers.

use near_sdk::json_types::{U64, U128};
use near_sdk::serde::Serialize;
use near_sdk::{AccountId, env, serde_json};

const STANDARD: &str = "selkie";
const VERSION: &str = "1.0.0";

/// One `claim` / `claim_failed` item: everything one recipient had waiting in
/// one token, sent to `account_id` as a single transfer.
#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ClaimData<'a> {
    pub recipient: &'a str,
    pub account_id: &'a AccountId,
    pub token: &'a AccountId,
    pub amount: U128,
    pub ids: Vec<U64>,
}

/// One `refund` / `refund_failed` item.
#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct RefundData<'a> {
    pub id: U64,
    pub sender: &'a AccountId,
    pub token: &'a AccountId,
    pub amount: U128,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
struct Event<'a, T: Serialize> {
    standard: &'static str,
    version: &'static str,
    event: &'a str,
    data: &'a [T],
}

/// Log `event` with `data` as a NEP-297 event. Never panics: it runs inside
/// callbacks, where a panic would skip putting failed payments back.
pub fn emit<T: Serialize>(event: &str, data: &[T]) {
    let body = Event {
        standard: STANDARD,
        version: VERSION,
        event,
        data,
    };
    // Plain structs of strings and wrapped integers always serialize.
    if let Ok(json) = serde_json::to_string(&body) {
        env::log_str(&format!("EVENT_JSON:{json}"));
    }
}
