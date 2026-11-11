# handle-escrow

The contract that lets you pay someone who has no wallet. This is Selkie's core on-chain piece and the thing no other Stellar payment app has: money addressed to a social handle, held by a neutral contract (not a company wallet) until the handle's owner proves who they are by logging in.

Stellar's native claimable balances cannot do this: they need a real account address at send time. This contract holds funds against a *hash* of the handle instead, so the recipient can be a complete stranger to Selkie and still get paid.

## The flow

```
sender ── deposit(token, amount, handle_hash, lifetime) ──▶ contract holds funds
                                                                │
                    owner signs in with that X/Telegram account │
                    backend (oracle) attests the login          ▼
recipient wallet ◀───────────── claim / claim_handle ─── funds released
                                                                │
                    never claimed and lifetime passed           ▼
sender ◀──────────────────────── refund ─────────────── funds returned
```

## Interface

| Function | Auth | What it does |
| --- | --- | --- |
| `deposit(sender, token, amount, handle_hash, lifetime) -> id` | sender | Lock `amount` of any Stellar token for a handle. Refundable after `lifetime` seconds (max 1 year). |
| `claim(id, recipient)` | oracle | Release one payment to `recipient` after a proven login. |
| `claim_handle(handle_hash, recipient) -> count` | oracle | Release everything waiting for a handle in one call: the "sign in once, collect it all" moment. |
| `refund(id)` | sender | Return an expired, unclaimed payment. Money is never stuck. |
| `pending(handle_hash) -> Vec<id>` | none (view) | Ids still waiting for a handle. |
| `get_payment(id) -> Option<Payment>` | none (view) | Inspect one payment. |
| `set_oracle(new_oracle)` | admin | Rotate the backend attestation key. |

Roles are deliberately minimal: the **oracle** (Selkie's backend key) can only route a release to a recipient after a login proof; it can never change amounts, take funds, or block a refund. The **admin** can only rotate the oracle. The **sender** can always recover expired funds.

## Handle hashing

The chain never sees a handle, only `sha256(utf8("<platform>:<username>"))` with the username lowercased and unprefixed, e.g. `sha256("x:amaka")`. This must match `handleKey` in `@selkie/core` (`packages/core/src/domain/handle.ts`). It is pseudonymity, not secrecy: anyone can hash a known handle and look it up. That is consistent with Selkie's honest privacy story.

## Security notes

- State is deleted **before** funds move, so double-claim, claim-then-refund, and refund-then-claim all fail on the second step. There is no reentrancy path.
- Amounts are `i128` with overflow checks compiled in; expiry math saturates.
- The contract is token-agnostic on purpose. Anyone can escrow a worthless token they invented; the backend only surfaces allowlisted assets (USDC first), so junk tokens never appear as balances in the product.
- `claim_handle` releases all pending payments in one transaction. If a handle ever accumulates enough deposits to hit Soroban resource limits, the transaction fails cleanly and the backend falls back to per-id `claim` calls in batches.
- The real crown jewel is the oracle key, not the contract. It lives with the backend, is rotatable via `set_oracle`, and every release is attributable on-chain through events.

## Develop

```
cargo test                     # run the full suite (happy paths + attack cases)
stellar contract build         # compile to WASM (target wasm32v1-none)
```

## Testnet deployment

| | |
| --- | --- |
| Contract | `CBQ54MQWSN32HX26QG2IJ2OFD2IKJBAPAHTDTV43TDUOSQWMO4V2CX5Y` |
| Network | testnet (protocol 27) |
| WASM hash | `fc403136e58eafa44361874c2e7485ca6f26d30e75090f621d4bf69eeeedb5fe` |

Machine-readable copy in `deployments/testnet.env`, which is what the backend and
the Stellar adapter read instead of hardcoding an address.

### Proven live, not mocked

The full flow was exercised against the deployed contract on testnet:

| Step | Result |
| --- | --- |
| `deposit` 10 XLM for `sha256("x:amaka")` | payment id 0, funds moved into the contract |
| `pending` | `[0]` |
| `claim_handle` to a wallet that did not exist when the payment was sent | recipient 10000 → 10010 XLM |
| `claim` attempted by a stranger | rejected, the contract requires the oracle's signature |
| `refund` of an unclaimed payment by its sender | sender +5 XLM back |

Deposit tx: [`53deeb10…`](https://stellar.expert/explorer/testnet/tx/53deeb10524e8477c44f6bcd80e195cce1e327d20ed68cc81cbb4542b6bf8e3d)
Claim tx: [`862c3bae…`](https://stellar.expert/explorer/testnet/tx/862c3bae0618a7eb29d8822ae533b0d94f3832fbc376685ef8f01379b91e1a04)

The handle hash on-chain (`3ced532c…`) is exactly `sha256("x:amaka")` as produced by
`handleHash()` in `@selkie/core`, which is what keeps the app and the ledger in
agreement about who a payment belongs to.
