//! The `msg` a sender passes to `ft_transfer_call`, and the checks that decide
//! whether the escrow keeps the money. Parsing is all-or-nothing: either every
//! payment in the message is valid, or the caller refunds the whole amount and
//! nothing is written.

use near_sdk::json_types::U128;
use near_sdk::serde::Deserialize;
use near_sdk::serde_json;

/// Most payments one `hold_many` may create. The bound is not about gas: NEAR
/// caps the logs of one receipt at 16 KiB, and the `hold` event carries one
/// item per payment (~350 bytes worst case). 40 leaves room; a larger batch
/// would fail on its own event, so it is refused up front instead.
pub const MAX_HOLD_ITEMS: usize = 40;

#[derive(Deserialize)]
#[serde(
    crate = "near_sdk::serde",
    tag = "kind",
    rename_all = "snake_case",
    deny_unknown_fields
)]
enum TransferMsg {
    /// The whole amount for one recipient key.
    Hold {
        recipient: String,
        lifetime_secs: u64,
    },
    /// One transfer split across several recipients (a group payout).
    HoldMany {
        lifetime_secs: u64,
        items: Vec<HoldItem>,
    },
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct HoldItem {
    recipient: String,
    amount: U128,
}

/// A message that passed every check: payments to create, sharing one lifetime.
#[derive(Debug, PartialEq)]
pub struct Hold {
    pub lifetime_secs: u64,
    /// (recipient key, amount) pairs, each amount > 0, summing to the amount sent.
    pub items: Vec<(String, u128)>,
}

/// Turn a raw `msg` into payments, or say why the money should go back.
pub fn parse(msg: &str, amount: u128, max_lifetime_secs: u64) -> Result<Hold, &'static str> {
    let parsed: TransferMsg =
        serde_json::from_str(msg).map_err(|_| "msg is not a valid hold or hold_many")?;
    let (lifetime_secs, items) = match parsed {
        TransferMsg::Hold {
            recipient,
            lifetime_secs,
        } => (lifetime_secs, vec![(recipient, amount)]),
        TransferMsg::HoldMany {
            lifetime_secs,
            items,
        } => {
            if items.is_empty() || items.len() > MAX_HOLD_ITEMS {
                return Err("hold_many needs between 1 and 40 items");
            }
            let mut sum: u128 = 0;
            for item in &items {
                sum = sum
                    .checked_add(item.amount.0)
                    .ok_or("item amounts overflow")?;
            }
            // Exact, not "at most": any slack would sit here with no record
            // pointing at it, owned by nobody.
            if sum != amount {
                return Err("item amounts must add up to the amount sent");
            }
            (
                lifetime_secs,
                items
                    .into_iter()
                    .map(|i| (i.recipient, i.amount.0))
                    .collect(),
            )
        }
    };
    if lifetime_secs == 0 || lifetime_secs > max_lifetime_secs {
        return Err("lifetime_secs is out of range");
    }
    for (recipient, item_amount) in &items {
        if *item_amount == 0 {
            return Err("every payment must be more than zero");
        }
        if !is_recipient_key(recipient) {
            return Err("recipient must be 64 lowercase hex chars");
        }
    }
    Ok(Hold {
        lifetime_secs,
        items,
    })
}

/// A recipient key is sha256 of an X identity as 64 lowercase hex chars. One
/// spelling only, so the same person can never end up under two keys.
pub fn is_recipient_key(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
