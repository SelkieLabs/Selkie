# NEAR HACKATHON progress

The running log the human reads between sessions: what works, what is cut, what
is next. Newest first within each section. Brief: [CLAUDE.md](../../CLAUDE.md).

## Status — Wed 11 Nov, evening Lagos

The human said to go ahead without waiting after the spikes, and to make the whole UI
NEAR (Stellar stays in the code, hidden from users).

| Step | State |
| --- | --- |
| 3. Setup | done |
| 4. Spike A (Privy NEAR wallet signs a delegate action) | server half passed; browser half is now the real Send flow |
| 4. Spike B | superseded by the full escrow below |
| 6.1 Escrow contract | **done**: tests green, deployed and initialised on testnet |
| 6.2 `packages/chain-near` | **done** (config, amounts, names, recipient keys, escrow calls, delegate build/sign/verify, relay policy, NearChain); 16 unit tests |
| 6.3 Backend NEAR mode | **done**: `SELKIE_CHAIN=near` serves its own Fastify app on its own DB; runs locally on :4100 |
| 6.4 Frontend NEAR mode | **built** (sign-in opens the account, send, refund, receive, key proof badge); needs the two-browser test with real X logins |
| Restored on NEAR (human asked) | **done**: Pay many (one signature, `hold_many` for non-users), pay any NEAR account, Cash out to a NEAR account or exchange, Requests. Each goes prepare → sign → relay. 16 app tests (`backend/api/src/near/app.test.ts`) run the real app on a simulated chain with real ed25519 signatures |
| Money in, live | **done**: the wallet polls every 12 s and on returning to the tab; new money in shows a toast ("@tunde sent you 2.00 USDC."). Deposits that skip Selkie (faucet, exchange, another wallet) now get a feed line "from outside Selkie" (`backend/api/src/near/balance-watch.ts`, migration 003). 6 more app tests (22 total) |
| Push notifications | **built**: Settings → "When money comes in" (and a one-time offer on Home) subscribes the browser to Web Push. Every money-in feed line also goes to the person's devices, even with Selkie closed. Server side tested with a fake push service (13 tests); **real delivery still to be checked in a browser**. iPhone needs Selkie added to the Home Screen first |
| Email notices | **built**: Settings → Notifications → By email. The address is proven with a 6-digit code, then every money-in line also sends an email (Resend), with a signed one-click unsubscribe. Locally `EMAIL_DEV_LOG=1` prints emails in the API console. **Local: Resend key set; mail goes out as "Selkie" from a domain already verified on the Resend account, so it reaches any inbox.** Later: verify selkiepay.com in Resend, set `EMAIL_FROM=Selkie <notify@selkiepay.com>`, and add both to the hosted API's env (human) |
| Contract-account warning | **done**: paying a NEAR account that runs a contract (a staking pool, a DAO) shows a warning with a box to tick; prepare refuses it with 409 unless the sender said yes. Live check: `stakely_v2.pool.f863973.m0` reads as a contract, `relayer.selkiepay.testnet` as a wallet |
| 7.3 X bot on NEAR (P2-a, safe version) | **done**: with `SELKIE_CHAIN=near` the bot never moves money and needs no bot secret. "send 5 to @amaka" is answered with `selkiepay.com/pay/amaka?amount=5`, "request 2.50 from @tunde" with `/ask/tunde?amount=2.50`; other assets get "On Selkie I move USDC". The link pages keep it across the X sign-in (30 min, this browser only) and fill Send or Requests once. Dry run still on by default. Checked: 124 bot tests, three replies run against an API stub that throws if called. Bot pocket (spending without a signature) not built |
| Oracle | **rotated** to `oracle-v2.selkiepay.testnet`: claim-only key, no allowance cap (see Setup) |
| 6.5 Copy | **done**: landing, FAQ, docs, settings, footer all NEAR |
| Full loop on testnet | **blocked on test USDC**: fund an account from faucet.circle.com (NEAR Testnet) |

## Escrow on testnet (6.1)

- [escrow.selkiepay.testnet](https://explorer.testnet.near.org/accounts/escrow.selkiepay.testnet): 275,370-byte WASM.
  - Top-up from faucet: [F8hynNn…](https://explorer.testnet.near.org/transactions/F8hynNnxrvMpXJPNenpHgPJCJ4obNTgw479thSARasUz)
  - Deploy: [CtYc7ZZ…](https://explorer.testnet.near.org/transactions/CtYc7ZZuJgCW8PqnTP5s7mN5zVGDopeVTVqx6pESzZhz)
  - Init (`new`, `#[private]`, signed by the escrow itself): [9R3PA5L…](https://explorer.testnet.near.org/transactions/9R3PA5LWGuTfkW2xWRXtfHPiK6Udbqo4MXxq8tVaFLzM)
- Owner `selkiepay.testnet`, oracle `oracle.selkiepay.testnet`, token allowlist = Circle testnet USDC, max lifetime 365 days.
- Build: `npm run build:contracts:near`. Redeploy: `npm run near:deploy-escrow`. Tests: `npm run test:contracts:near`.
- **Hardened 11 Nov** (redeploy [CUmdfux…](https://explorer.testnet.near.org/transactions/CUmdfuxxvkb3ayVYECdmSR2uoFKTYzEX5UUaRLF6iAtb), state kept):
  - Owner methods (`set_oracle`, `add_token`, `remove_token`, `set_min_hold`) want exactly
    1 yoctoNEAR, so only a full-access key can call them. Checked live: the owner calling
    `set_oracle` with no deposit is refused ("Requires attached deposit of exactly 1 yoctoNEAR").
  - Smallest held payment per token, `min_hold` (USDC: 0.01, set in
    [HpP9EFt…](https://explorer.testnet.near.org/transactions/HpP9EFtdX1YHE4Fn4zJtpSBv2cSEamq7nTEAnN77PmEf)).
    A hold or hold_many with any item below it is refunded whole, so filling the escrow's
    storage with dust costs real money. Prepare refuses those amounts before signing.
    Stored outside the state struct, so the upgrade needed no migration.

## How it runs locally (NEAR mode)

```
SELKIE_CHAIN=near PORT=4100 npx tsx --env-file=.env backend/api/src/index.ts   # API, needs NEAR_DATABASE_URL
SELKIE_API_ORIGIN=http://localhost:4100 npm run dev:web                       # web on :3000, NEAR by default
```

## Setup (section 3)

- Tag `pre-hackathon` → `839acbb` (local only, not pushed). Branch `near` (local only).
- NEAR agent skills installed in `.claude/skills/` (gitignored; `skills-lock.json` records them).
- `packages/chain-near` created with `near-api-js@7.4.0` (pinned: 7.5.x shipped four releases on 11 Nov).
- `contracts-near/` is its own Cargo workspace (`resolver = "3"`, cargo-near template's release profile).
- Testnet accounts, created by `npm run near:setup` (idempotent; keys appended to `.env`, never printed):

| Account | Holds | Key Selkie holds |
| --- | --- | --- |
| [selkiepay.testnet](https://explorer.testnet.near.org/accounts/selkiepay.testnet) | root, faucet-funded (10 NEAR) | full access, setup scripts only |
| [x.selkiepay.testnet](https://explorer.testnet.near.org/accounts/x.selkiepay.testnet) | 1 NEAR | full access, CreateAccount only |
| [escrow.selkiepay.testnet](https://explorer.testnet.near.org/accounts/escrow.selkiepay.testnet) | 3 NEAR (pays its own storage) | full access (deploy key; delete or document later) |
| [relayer.selkiepay.testnet](https://explorer.testnet.near.org/accounts/relayer.selkiepay.testnet) | 2 NEAR | full access |
| [oracle-v2.selkiepay.testnet](https://explorer.testnet.near.org/accounts/oracle-v2.selkiepay.testnet) | 2 NEAR | **function-call only**: `escrow.selkiepay.testnet` / `claim`, no allowance cap. The escrow's oracle since 11 Nov |
| [oracle.selkiepay.testnet](https://explorer.testnet.near.org/accounts/oracle.selkiepay.testnet) | 0.5 NEAR | retired: function-call only, `claim`, 0.25 NEAR allowance |

- **Why the oracle moved.** A function-call key's allowance only shrinks: each claim
  reserves 300 Tgas (~0.03 NEAR) against it and unused gas goes back to the balance,
  not the allowance. 0.25 NEAR was about eight claims, and the oracle has no full key to
  add a bigger one (by design). `npm run near:rotate-oracle -- oracle-v2` created the new
  account, called `escrow.set_oracle` as owner, and updated `.env`. Fresh setups now get
  the uncapped key directly. `prove:keys` reads the current oracle from the escrow's
  `get_config`, so it covers both.

- `selkiepay.testnet` and `escrow.selkiepay.testnet` are registered (storage_deposit) on testnet USDC.

### Deviations from the brief, and why

- **Setup script lives at `packages/chain-near/scripts/setup-testnet.ts`** (run with
  `npm run near:setup`), not `scripts/near/`. Section 1.3 says only `packages/chain-near`
  imports NEAR SDKs, and `chain-stellar` already keeps its scripts the same way.
- **No cargo-near.** Its installer (`curl | sh`) was blocked by the agent's sandbox, and
  `cargo install cargo-near` needs rustc 1.95; installing 1.95 over this connection
  (~40 KB/s) was going to take over an hour. Contracts build with plain cargo using
  exactly the flags cargo-near uses (`-C link-arg=-s --cfg near`, wasm32-unknown-unknown,
  release). Verified in cargo-near's source that nearcore accepts rustc ≥ 1.87 output
  from protocol 84 (testnet is on 88). No wasm-opt pass yet: the WASM is a bit larger.
- **near-sdk 5.29.1, not 5.30.** 5.30 needs rustc 1.95; 5.29 needs 1.93.
- **No `test-usdc` contract.** Real Circle USDC exists on NEAR testnet, so per 6.1 we use it.

## Verified facts (section 10)

| Question | Answer | Source |
| --- | --- | --- |
| Privy extended-chains import | `@privy-io/react-auth/extended-chains` → `useCreateWallet`, `useSignRawHash`, `useExportWallet` | installed 3.36.1 `dist/dts/extended-chains.d.mts` |
| Privy NEAR `chainType` | `'near'` (in `CurveSigningChainType`) | `@privy-io/api-types` 0.18.0 |
| Raw-sign format | `signRawHash({ address, chainType: 'near', hash: '0x…' })` → `{ signature: '0x…' }` (64-byte ed25519) | types + spike A |
| Privy NEAR wallet address | the **implicit account id** = hex of the ed25519 public key; REST `public_key` = `00` + that hex | spike A (server) |
| Server reads a user's NEAR key | `linked_accounts[]` entry with `type: 'wallet'`, `chain_type: 'near'`, `address` (hex key) | Privy user object; backend already parses `chain_type` |
| near-api-js version | 7.4.0 pinned (7.5.3 latest, released the same day) | npm |
| Delegate-action helpers | `Account.createSignedMetaTransaction({ receiverId, actions, blockHeightTtl })` → `{ delegateHash, signedDelegate }`; `Signer.signDelegateAction` hashes `sha256(NEP-461 prefix ++ borsh(DelegateAction))` and passes the 32-byte hash to `signBytes`; `encodeSignedDelegate` / borsh `SCHEMA.SignedDelegate`; `relayer.relayMetaTransaction(signedDelegate)` | near-api-js 7.4.0 source |
| near-sdk | 5.29.1 (5.30.1 is latest but needs rustc 1.95) | crates.io index |
| Testnet RPC | `https://test.rpc.fastnear.com` (protocol 88, nearcore 2.14.0-rc.5 on 11 Nov) | docs.near.org RPC providers + live `status` |
| Testnet explorer | `https://explorer.testnet.near.org/accounts/<id>`, `/transactions/<hash>` (nearblocks returns 403 to scripts) | near-cli-rs config + live check |
| Testnet faucet | `POST https://helper.nearprotocol.com/account { newAccountId, newAccountPublicKey }` | near-cli-rs source |
| Testnet USDC | `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af` (Circle; symbol USDC, 6 decimals) | developers.circle.com + live `ft_metadata` |
| Mainnet USDC | `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` per Circle — **re-check against 1Click `/v0/tokens` before use** | developers.circle.com |
| USDC `storage_balance_bounds` | min = max = `1250000000000000000000` yocto (0.00125 NEAR) | live call |
| Hackathon rules | re-read live 11 Nov: tags `pre-hackathon` + `hackathon-submission` (or a branch) + README diff link; hosted demo up through 18 Nov, ideally 25 Nov; 1Click JWT optional (0.2% fee without) | nearhackathon.com/HACKATHON.md |

Still to verify: 1Click fields/statuses (7.1), Sputnik testnet factory (7.2),
X API v2 user lookup (5.3; the code calls `GET https://api.x.com/2/users/by/username/:u`
only when `X_BEARER_TOKEN` is set, unverified).

## Spike A — Privy NEAR wallet signs a NEP-366 delegate action

**Part 1, server (PASSED).** `packages/chain-near/spikes/spike-a-server.ts`

1. Privy REST created a NEAR wallet (`chain_type: near`); address `aac8a5ec…a207` (implicit), key `ed25519:CVfmFEtx…g74S`.
2. Root created [spike-a.selkiepay.testnet](https://explorer.testnet.near.org/accounts/spike-a.selkiepay.testnet) with that key as its **only** key ([tx](https://explorer.testnet.near.org/transactions/Fig1eSveEtrVKKEJpMXsUWSUpyPvw3L9bZso84Uedbyz)).
3. near-api-js built the DelegateAction (USDC `ft_balance_of`), hashed it, and Privy `raw_sign` signed the hash. Signature verified locally against the Privy key.
4. Relayer submitted it: [tx 4Y1jvph…](https://explorer.testnet.near.org/transactions/4Y1jvphjESXyAPpXkSCHeNYysTnTGUA74xJq6fjcjswN). Outer signer `relayer.selkiepay.testnet`; inner receipt executed by `spike-a.selkiepay.testnet` on the USDC contract; `SuccessValue`.

**Part 2, browser (BUILT, waiting on a sign-in).** `frontend/src/app/spike/near/page.tsx` + local relay `packages/chain-near/spikes/spike-a-relay.ts`.
Same flow with a user-owned embedded wallet and `useSignRawHash`, building the delegate
action in the browser. Relay path tested headlessly ([tx 7HoAf64…](https://explorer.testnet.near.org/transactions/7HoAf64UvaZWaJRAt5eoUvjyV7aVcMZELiChyedY51Sp)); page compiles under Turbopack with near-api-js in the client bundle.

## Spike B — escrow skeleton receives an FT transfer

`contracts-near/handle-escrow` (skeleton: owner/oracle/token allowlist; `ft_on_transfer`
parses `{"kind":"hold",...}`, emits a NEP-297 `hold` event, refunds on a bad msg or
unknown token) + `packages/chain-near/spikes/spike-b.ts` (deploy, init, 1 USDC
`ft_transfer_call`, print logs). Waiting on USDC in `selkiepay.testnet`.

### More deviations (product work)

- **No separate `POST /near/account`.** The account is created inside the existing
  `POST /auth/session` with `createAccount: true`, through the same `IdentityService`
  Stellar uses (`IdentityChain.openAccount`). The web app calls it automatically on the
  first X sign-in, after creating the Privy NEAR wallet, so money waiting for the
  handle is claimed in the same request. Same checks as the brief: X login present,
  the key is this Privy user's NEAR wallet.
- **`IdentityService` refactor** is the "preferred" plan from 6.3: a small
  `IdentityChain` interface (`backend/api/src/identity/chain.ts`) that the Stellar
  adapter satisfies unchanged, and `NearIdentityChain` for NEAR.
- **NEAR is the web app's default chain** on this branch (`NEXT_PUBLIC_SELKIE_CHAIN=stellar`
  brings Stellar back). Hidden on NEAR via `frontend/src/lib/chain.ts` `features`:
  Convert, Telegram, Google sign-in, airtime/bills. Pay many, Cash out, pay-to-address
  and Requests were hidden at first and are back (the human asked), all on NEAR.
- **Pay many is capped at 20 people on NEAR** (`MAX_PAY_MANY`). The list is one delegate
  action on the USDC contract: direct `ft_transfer`s to Selkie users plus one
  `ft_transfer_call` with `hold_many` for everyone else. The relayer caps a delegate's
  total gas at 900 Tgas (testnet allows 1 PGas per transaction).
- **Money from outside Selkie is written to the feed.** A handle account is a real NEAR
  account, so anyone can pay it without Selkie. `near_accounts.seen_usdc` is the
  balance Selkie expects. Every send, claim and refund it records moves that number.
  Reading the balance (`GET /me`) compares it with the chain. A difference becomes a
  "receive" (or "send") line with counterparty "outside Selkie", but only after it has
  held for 10 s with no Selkie payment in flight for that account. That wait absorbs
  RPC lag and the gap between a transaction landing and Selkie recording it.
  Accounts opened before this start counting at 0 if their feed is empty (so a faucet
  balance shows up), otherwise at their current balance.
- **Web Push for money in** (not in the brief; the human asked). `backend/api/src/push/`:
  - `notifyingActivity` wraps the activity store. Every way money arrives already writes
    a feed line there, so a new way of receiving cannot forget to notify.
  - Endpoints must be on a known push service (FCM, Mozilla, Apple, Microsoft), so a
    signed-in user cannot make the server POST to an internal address.
  - Keys: `npm run push:keys` writes `WEB_PUSH_PUBLIC_KEY` / `WEB_PUSH_PRIVATE_KEY` to
    `.env`. The subject defaults to `SELKIE_WEB_URL`. **The hosted API needs the same
    keys set**, or push stays off there.
  - Library: `web-push` pinned at 3.6.7. 4.0.0 came out 2026-11-06 and is ESM-only;
    too new to trust a day before a deadline.
  - The service worker (`frontend/public/sw.js`) always shows a notification. It is
    silent when a Selkie tab is focused, because Safari withdraws push from sites that
    receive one and show nothing.
  - Signing out unsubscribes the browser.
- **Email notices** (not in the brief; the human asked). `backend/api/src/email/`, shared
  wording in `backend/api/src/notify/arrival.ts`:
  - X sign-in gives no email, so the address is typed in and proven with a code. Only a
    sha256 of the code is stored. It lasts 15 minutes, allows 5 tries, and a new one can
    be asked for after 60 s.
  - Nothing but the code goes to an unproven address.
  - Each email carries an HMAC-signed unsubscribe link plus
    `List-Unsubscribe`/`List-Unsubscribe-Post` (RFC 8058). The link page asks before
    stopping, so mail scanners cannot unsubscribe anyone.
  - Env: `RESEND_API_KEY`, `EMAIL_FROM` (a domain verified in Resend), optional
    `EMAIL_LINK_BASE_URL`, `EMAIL_LINK_SECRET`.
- **Fixed: a `/auth/link` 404 on every load.** Privy lists the embedded NEAR wallet as a
  linked account, so NEAR users looked one identity short. Now only sign-in methods
  count, and NEAR never attaches.
- **Cash out on NEAR = a transfer to any NEAR account** (your wallet or an exchange's
  deposit account), shown as "cashout" in the feed. To other chains it needs NEAR Intents
  on mainnet; the screen says so. Bank cash-out stays the pre-existing "almost open" screen.

## Cut / deferred

- Nothing from P0 cut.

## Next

1. Human: get test USDC from faucet.circle.com (NEAR Testnet) into your account, then
   run the two-browser loop (6.4 acceptance) and try Pay many, Requests and Cash out.
2. `npm run test:live:near` once `selkiepay.testnet` has 0.02 USDC.
3. README top + `docs/hackathon/SUBMISSION.md`; MIT LICENSE (missing today).
4. P1: Intents add-money / cash-out (mainnet, needs OK); DAO payout script.
