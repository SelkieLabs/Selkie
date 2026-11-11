# Selkie on NEAR: build brief for the coding agent

> For the human: this file sits at the repo root as CLAUDE.md on the `near` branch.
> Start Claude Code in the repo and say: "Read CLAUDE.md fully. Do section 3
> (setup) and the two spikes in section 4, report results, then wait for my OK."

## 0. Read this first (agent)

You are building the NEAR version of Selkie for the NEAR HACKATHON. Selkie already works on Stellar testnet. Your job is to add NEAR, make NEAR the version judges see, and keep the Stellar code working and untouched.

Selkie in one line: send money to any X handle. The person you pay needs no app, no wallet, no gas. If they have never used Selkie, the money waits in a contract until they sign in with that X account.

What makes the NEAR version better than the Stellar one (this is the pitch):

1. **Selkie holds zero keys to user accounts.** On Stellar, the backend stores every user's private key (sealed in Postgres) and signs for them. On NEAR, each user's key is their Privy embedded NEAR wallet. The backend never sees it. Anyone can check this on the explorer: the user's account has exactly one key, and it is theirs.
2. **A handle becomes a real, human-readable account.** @amaka claims and gets `amaka.x.selkiepay.testnet` (mainnet: `amaka.x.selkiepay.near`).
3. **Nobody pays gas.** Users sign NEP-366 delegate actions; Selkie's relayer pays the fees.
4. **Any chain in, any chain out with NEAR Intents (1Click API):** add money from USDT on Tron or USDC on Base, cash out to the chain you use.
5. **Payments wait for an X user ID, not a username.** Usernames get renamed and re-registered. The escrow keys on the X numeric ID when we can resolve it.

Everything you build must serve those five points and one demo moment: pay a real person who has never used NEAR, they sign in with X, the money is in `theirname.x.selkiepay.testnet`, and the explorer shows Selkie holds no key.

## 1. Hard rules

### 1.1 Hackathon rules (from https://nearhackathon.com/HACKATHON.md, re-read it live)

- Submission deadline: **2026-11-14 23:59 UTC** (= Saturday 00:59 Lagos time). The submission API returns 403 after that. Aim to submit Friday evening.
- The hackathon starts 2026-11-01; code written since 2026-10-19 counts. Selkie's last commit before this work is `839acbb` (2026-10-06), so all Stellar code is pre-existing baseline. Only NEAR work built now is judged.
- Tag `839acbb` as `pre-hackathon`. Do all work on branch `near`.
- The README must disclose the Stellar baseline and link the diff (`compare/pre-hackathon...near`).
- Libraries and AI-generated code are allowed. List libraries in the README.
- Testnet-only is eligible. NEAR Intents has no testnet: use mainnet with tiny amounts and `dry: true` quotes.
- Repo must be public with a LICENSE (MIT) through judging.
- The README is read by AI judges (Claude Code and Codex) first. They check that it runs and does what it says. Write numbered "do X, see Y" steps.
- Demo: a public X post saying it was built at NEAR HACKATHON, tagging @NEARProtocol and #NEARHackathon, with a video (screenshots alone are not enough for a local-only demo). The human posts it.
- One person may enter up to 2 projects. If the human enters a second one, each README must name the other. Ask the human for the other project's name before finalizing the README.
- Tracks for this project: realworld (primary), social (only if the DAO payout in 7.2 ships), agents (only if the bot pocket in 7.3 ships).

### 1.2 Never do these without the human's explicit OK in chat

- Submit the hackathon form or call the submission API.
- Post on X, or turn the X bot's dry run off.
- Make anything public, change the default branch, or merge `near` into `main`.
- Spend mainnet funds, deploy to mainnet, or create mainnet accounts.
- Touch payout addresses or anything holding real money.
- Delete or rewrite Stellar code, migrations, or git history.
- Commit secrets. Keys go in `.env` files that are gitignored. Never print a private key in logs, tests, or chat.

### 1.3 Engineering rules

- Never guess contract addresses, RPC URLs, SDK versions, method names, or API fields. Look them up: NEAR agent skills (`npx skills add near/agent-skills`), https://docs.near.org/llms.txt, https://docs.near-intents.org/llms.txt, and the Privy docs. Section 10 lists what to verify.
- Testnet first. Mainnet only in step P1-c, with the human's OK.
- Match the repo's style: small commits with plain-English imperative messages (look at `git log`), comments that explain why, `node:test` + `tsx` tests, decimal strings for money (never floats).
- Keep the repo's architecture rule: only `packages/chain-near` imports NEAR SDKs (including the browser signer, exported from a subpath). Contracts live in their own Cargo workspace.
- When a step's acceptance check fails twice, stop and report. Do not paper over it.
- Keep a running `docs/hackathon/PROGRESS.md`: what works, what is cut, what is next. The human reads it between sessions.

## 2. What already exists (do not rebuild it)

```
frontend/                 Next.js 16 + Tailwind + Privy (Google + X login)
  src/components/wallet/  SendPanel, PayManyPanel, ReceivePanel, CashOutPanel,
                          ActivityFeed, BalanceCard, TransactionSheet, ...
  src/components/landing/ Faq.tsx (has a claim we must fix, see 6.5)
  src/lib/api.ts          the only place the web app calls the API
backend/
  api/                    Fastify API. index.ts wires everything. app.ts = routes.
                          identity/ = Privy sign-in, linking, claiming.
                          activity/, requests/, idempotency/ = Postgres stores.
  bot/                    X bot (dry run by default)
packages/
  core/                   chain-agnostic: ChainAdapter interface, HandleRef,
                          Money, handleHash() = sha256("x:<username>")
  chain-stellar/          the Stellar adapter (only Stellar code lives here)
contracts/                Soroban workspace: handle-escrow (Stellar)
```

Key facts from the code:

- `VerifiedIdentity.subject` for X is the numeric X user ID. Linking already uses it. The Stellar escrow, however, keys on `sha256("x:<username>")`. The NEAR escrow fixes that (5.3).
- Selkie requires a linked X (or Telegram) handle before a user can send. Keep that rule. On NEAR, only X is in scope; Telegram stays deferred.
- The backend signs everything server-side on Stellar. On NEAR the browser signs and the backend only relays. That is the main architectural change.

## 3. Setup (do this first)

1. `git tag pre-hackathon 839acbb` and `git checkout -b near`. Do not push tags or branches without asking.
2. Install the NEAR agent skills and read the skills for near-smart-contracts, near-api-js (or near-kit), near-intents, near-dapp.
3. Install Rust + cargo-near (check the docs for the current install command).
4. Create `contracts-near/` as a separate Cargo workspace (do not add NEAR crates to `contracts/`, which is the Soroban workspace with its own profile).
5. Create testnet accounts (the human may need to fund or approve these). One root and named children so the explorer reads cleanly:

| Account | Purpose | Key held by backend |
| --- | --- | --- |
| `selkiepay.testnet` (or available variant) | root, owns the rest | full access, only used by setup scripts |
| `x.selkiepay.testnet` | parent of every handle account | full access; used ONLY for CreateAccount |
| `escrow.selkiepay.testnet` | the handle-escrow contract | none after deploy (delete deploy key once stable, or keep and document) |
| `usdc.selkiepay.testnet` | test USDC (only if no real testnet USDC, see 10) | none needed |
| `relayer.selkiepay.testnet` | pays gas for users' delegate actions | full access |
| `oracle.selkiepay.testnet` | releases escrowed money after a proven login | function-call key scoped to escrow claim only |

Put names and keys in `.env` (see 6.6). Write `scripts/near/setup-testnet.ts` that creates these idempotently, so the README can say "run this once".

## 4. Spikes (do before writing product code; report results, then wait)

These two things decide the design. Spend at most ~2 hours each.

**Spike A: Privy embedded NEAR wallet can sign a NEAR delegate action.**

- Privy lists NEAR as a supported chain with raw hash signing (Tier 2). `@privy-io/react-auth` has an extended-chains entry with `useCreateWallet` and `useSignRawHash`. Verify the exact import path and the `chainType` value for NEAR in the docs for the installed version (Selkie uses ^3.36.1).
- In a throwaway page: sign in, create the user's NEAR wallet, get its ed25519 public key, build a DelegateAction (e.g. ft_transfer of 0 test USDC, or a harmless view-like call), compute the NEP-366 hash (sha256 of the NEP-461 prefixed borsh encoding, use the library helper, don't hand-roll it), sign that hash with `useSignRawHash`, and have a relayer script submit it on testnet.
- **Pass:** a testnet transaction where the inner action's signer is an account whose only key is the Privy wallet's public key.
- **If it fails:** fallback is a device key: generate an ed25519 keypair in the browser, store it in IndexedDB, add it as the account's full-access key, and add a "Back up your key" screen. Note this changes the FAQ's "nothing to write down" promise. Report and ask the human which way to go.

**Spike B: the escrow contract skeleton deploys and receives an FT transfer.**

- Deploy test USDC (or use real testnet USDC if it exists), deploy an escrow that implements `ft_on_transfer` and logs the msg, and send 1 test USDC with `ft_transfer_call`.
- **Pass:** the transfer lands and the log shows the parsed msg.

Report both results in chat with tx hashes and explorer links. Wait for OK.

## 5. The design

### 5.1 Accounts and keys

```
@amaka signs in with X (Privy) for the first time
        │
        ├─ browser: Privy creates amaka's embedded NEAR wallet (ed25519)
        │           Selkie never sees the private key
        ├─ POST /near/account { nearPublicKey }
        │
        ▼
backend (account creator = x.selkiepay.testnet)
        ├─ checks: user signed in with X just now (attestation "login")
        ├─ checks: nearPublicKey is this Privy user's NEAR wallet (Privy API)
        ├─ picks name: amaka.x.selkiepay.testnet  (rules in 5.2)
        ├─ tx: CreateAccount + Transfer(small NEAR for storage)
        │      + AddKey(nearPublicKey, FullAccess)          ← the only key
        ├─ relayer: storage_deposit on USDC for the new account
        └─ oracle: escrow.claim(recipient keys of amaka) → money lands
```

- The account's only access key is the user's Privy NEAR key. Selkie's backend adds no key. This is the claim judges must be able to verify: `view_access_key_list` returns exactly one key.
- Do not store any user private key anywhere. The Stellar `wallet_keys` table is not used in NEAR mode.

### 5.2 Account naming

- Pattern: `<name>.x.selkiepay.<network>` where `<name>` comes from the X handle.
- Sanitize: lowercase; strip leading/trailing `_`; collapse repeated `_`; must match NEAR's account-id rules (verify the exact regex in docs: lowercase alphanumerics separated by single `-` or `_`, total length 2 to 64).
- If the name is taken (on chain or in our table): append `-` + last 4 digits of the X user ID. If still taken, use `x<xUserId>`.
- The account name is permanent even if the person later renames on X. That is fine: the table maps X user ID to account.
- Only people who proved an X login get an account under `x.`. That is why the namespace is safe from squatting.

### 5.3 Who money waits for (recipient keys)

The escrow stores a 32-byte recipient key, hex encoded:

- Preferred: `sha256(utf8("x-id:" + xUserId))` when the backend can resolve @username to an X user ID (X API v2 user lookup by username; needs an X bearer token, optional env `X_BEARER_TOKEN`).
- Fallback: `sha256(utf8("x:" + username))`, byte-identical to `handleHash()` in `@selkie/core`, when no lookup is available.
- On claim, the backend claims both keys for the user (ID-based and current username-based), so either scheme pays out.
- Put the new hash function next to `handleHash()` in `packages/core/src/domain/handle.ts` with a test and a comment explaining why the ID form exists (renamed handles).

### 5.4 The two send paths (web, NEAR mode)

```
User types @amaka + amount
   │
   ├─ GET /handles/amaka  → onSelkie? (extend response with nearAccount)
   │
   ├─ yes ─▶ prepare: USDC.ft_transfer(amaka.x.selkiepay.testnet, amount)
   │
   └─ no ──▶ prepare: USDC.ft_transfer_call(escrow, amount,
   │                     msg={"kind":"hold","recipient":"<hex>","lifetime_secs":N})
   │
   ├─ POST /near/payments/prepare → backend returns the exact actions, the
   │   sender's current nonce, and a block height for max_block_height
   ├─ browser builds the DelegateAction, signs its hash with Privy
   └─ POST /near/relay { prepareId, signedDelegate }
        backend checks the signed actions EQUAL the prepared ones,
        then submits with the relayer key and records activity
```

Refund (sender takes back an expired, unclaimed payment) uses the same prepare → sign → relay flow with `escrow.refund(id)`.

### 5.5 Relayer safety (this is a security feature, show it in the README)

`POST /near/relay` accepts a SignedDelegate only if all hold:

- the caller is signed in, and `delegate.sender_id` is their NEAR account;
- it matches a prepare record created for this user in the last few minutes (same receiver, method, args, deposit), and that record is unused;
- receivers are only the USDC contract or the escrow contract, and methods only `ft_transfer`, `ft_transfer_call`, `storage_deposit`, `refund` (+ `pocket_*` if 7.3 ships); for Intents cash-out (6.4) `ft_transfer` to the quote's deposit address is allowed only when a matching quote exists;
- attached deposit is at most 1 yoctoNEAR (the relayer pays it); gas capped;
- per-user rate limit (reuse the API's existing limiter).

### 5.6 What the backend can and cannot do (the trust model)

| Who | Can | Cannot |
| --- | --- | --- |
| Relayer key | pay gas for actions the user signed | create or change what the user signed |
| Account creator (`x.`) | create a new handle account with the user's key | add a key to an existing account, move user money |
| Oracle key | release escrowed money to an account after a proven X login | take money, change amounts, block a refund |
| Escrow contract | hold money for a recipient key; refund to sender after expiry | release to anyone except via the oracle |
| Privy | holds the user's key material (their model, their trust) | — Selkie does not enable server-side session signers |

Be honest in the README: the oracle is a trust point (a compromised oracle could route waiting money to the wrong account), and users trust Privy for key custody. Money already in a user's account is out of Selkie's reach.

## 6. Build plan (P0 = must ship)

Each step ends with an acceptance check. Do them in order.

### 6.1 P0-a: `contracts-near/handle-escrow` (Rust, near-sdk)

State:

- `owner: AccountId` (can rotate oracle, can update token allowlist)
- `oracle: AccountId`
- `tokens`: set of AccountId allowed to be held (USDC)
- `max_lifetime_secs: u64` (365 days)
- `next_id: u64`
- `payments: id → Payment { sender, token, amount: U128, recipient: String(hex 64), expiry_ns: u64 }`
- `by_recipient: recipient → Vec<u64>` (or a set)

Methods:

| Method | Who | Does |
| --- | --- | --- |
| `new(owner, oracle, tokens, max_lifetime_secs)` | init | |
| `ft_on_transfer(sender_id, amount, msg) -> U128` | token contract | Only from an allowed token. Parse msg. `{"kind":"hold","recipient":hex64,"lifetime_secs":n}` creates one payment. `{"kind":"hold_many","lifetime_secs":n,"items":[{"recipient":hex64,"amount":"..."}]}` creates several; their sum must equal amount. Invalid msg or bad sum: create nothing and return amount (full refund). |
| `claim(recipient, account_id) -> u32` | oracle only | Remove the recipient's index and payments FIRST, then ft_transfer the total per token to account_id (attach 1 yocto), then callback `on_claim_resolved` that restores the payments if the transfer failed. Returns count released. |
| `refund(id)` | original sender only | Only after expiry. Remove first, ft_transfer back, callback restores on failure. |
| `pending(recipient) -> Vec<PaymentView>` | view | |
| `get_payment(id) -> Option<PaymentView>` | view | |
| `set_oracle(oracle)` | owner | |

Events: emit NEP-297 logs (`EVENT_JSON:{"standard":"selkie","version":"1.0.0","event":"hold"|"claim"|"refund","data":[...]}`) with ids, so the backend can link a send to its later claim.

Storage: the contract pays for its own records from its NEAR balance. Fund it on testnet and document this.

Tests (must pass, `cargo test`): hold then claim; hold_many then claim; wrong token rejected; bad msg fully refunded; hold_many with wrong sum fully refunded; non-oracle claim fails; double claim pays once; refund before expiry fails; refund by non-sender fails; claim-then-refund and refund-then-claim both fail on the second step; failed ft_transfer restores the payment (simulate the callback). Use near-sdk unit tests; add near-workspaces sandbox tests if time allows.

Also: `contracts-near/test-usdc` = a minimal NEP-141 (6 decimals, symbol USDC, name "Selkie Test USDC") with a `faucet()` that mints a small capped amount per account per day. Only build this if real testnet USDC is not available.

**Accept:** deployed to testnet; a script holds 1 USDC for a recipient key and the oracle claims it into a fresh account; explorer links in PROGRESS.md.

### 6.2 P0-b: `packages/chain-near`

The only package that imports NEAR SDKs. Suggested files:

| File | Responsibility |
| --- | --- |
| `config.ts` | network config from env (testnet/mainnet only differ by config) |
| `amounts.ts` | decimal string ⇄ base units (USDC 6 decimals). Never floats. Tests. |
| `names.ts` | handle → account name (5.2). Tests for every sanitization case. |
| `recipient.ts` | recipient key helpers using the core hash functions (5.3) |
| `accounts.ts` | create handle account with a given public key; storage_deposit; `listKeys(accountId)` for the proof screen |
| `escrow.ts` | typed client: build hold / hold_many / refund actions; oracle claim; views; parse events |
| `relayer.ts` | validate a SignedDelegate against a prepare record (5.5); submit; return tx hash + outcome |
| `intents.ts` | 1Click client: tokens, quote (dry and real), status (6.4) |
| `adapter.ts` | `NearAdapter implements ChainAdapter` for the server-side subset: ensureAccount, getBalance, claim. Its `send` is only used by the bot pocket (7.3); otherwise it throws a clear "client-signed on NEAR" error. `capabilities = { claimableSends: true, gasless: true, ramp: false }`. |
| `browser.ts` (subpath export `@selkie/chain-near/browser`) | build a DelegateAction from prepared actions + nonce + block height; hash it; take a `signHash(hash) => signature` function (Privy) and return the base64 SignedDelegate. No Privy import here; the frontend passes the function in. |

Write a README for the package in the same style as `packages/chain-stellar/README.md`.

**Accept:** `npm test` passes; a live script `npm run test:live:near` does: create account → hold → claim → balance check → refund path, on testnet.

### 6.3 P0-c: backend NEAR mode

- New env `SELKIE_CHAIN=near|stellar` (default stellar, so nothing changes for the existing build). NEAR mode uses its own database (separate `DATABASE_URL`), so Stellar data never mixes in.
- Migration `002_near.sql`: `near_accounts (user_id PK, account_id UNIQUE, public_key, x_user_id UNIQUE, created_at)` and `near_prepares (id, user_id, actions_json, expires_at, used_at)`.
- Put NEAR routes in `backend/api/src/near/` as a Fastify plugin registered only in NEAR mode:

| Route | Does |
| --- | --- |
| `POST /near/account` | create-or-return the user's NEAR account (5.1), then claim waiting money; returns `{ accountId, claimed }` |
| `GET /near/account/keys` | the access keys on the user's account, for the proof badge |
| `POST /near/payments/prepare` | `{ to, amount, note? }` or `{ refundId }` → prepared actions + nonce + block height + prepareId |
| `POST /near/relay` | `{ prepareId, signedDelegate }` → validate (5.5), submit, record activity, return `{ status, ref, waitingToBeClaimed }` |
| `GET /near/intents/tokens`, `POST /near/intents/quote`, `GET /near/intents/status` | proxy to 1Click (6.4); the JWT stays server-side |

- `IdentityService` is typed against `StellarAdapter`. Before refactoring it, propose a minimal plan in chat and wait. Preferred: introduce a small interface with only the methods IdentityService calls, have the Stellar adapter satisfy it unchanged, and give NEAR mode its own implementation (claim via the oracle; "receivable" = account exists).
- Extend `GET /handles/:username` (NEAR mode only) with `nearAccount` when the handle belongs to a Selkie user, and `recipientKey` + `scheme` (`"x-id"` or `"username"`) when not.
- `GET /me` in NEAR mode returns the NEAR account as address and USDC balance from `ft_balance_of`.
- Activity: record sends as "waiting" with the escrow payment id as claimRef; settle them when the oracle claims (reuse `activity.settleByClaimRef`).

**Accept:** with curl or a script: sign in (Privy test token), create account, prepare + relay a hold, second user signs in and receives it, activity shows both sides.

### 6.4 P0-d: frontend NEAR mode

- `NEXT_PUBLIC_SELKIE_CHAIN=near` switches the wallet to NEAR mode. Do not break Stellar mode.
- On sign-in: ensure the Privy NEAR wallet exists (create if needed), then call `POST /near/account`. Show what was waiting: "$2.00 from @tunde was waiting for you. It's yours."
- Send: reuse SendPanel. In NEAR mode it calls prepare → signs with Privy (`useSignRawHash`) via `@selkie/chain-near/browser` → relay. Same copy as today ("Sent. It is waiting for @amaka to claim.").
- Refund: from the activity row of a waiting payment, after expiry.
- Receive: show `amaka.x.selkiepay.testnet` with copy + QR, and "Add money from another chain" (6.5, mainnet only; on testnet show the test USDC faucet).
- Proof badge (the demo moment): on the balance card, "Keys on this account: 1 — yours. Selkie holds none." with a link to the account on the testnet explorer (verify the explorer URL). Data from `GET /near/account/keys`.
- Hide in NEAR mode (capabilities, not deleted code): Convert, Requests, Telegram, airtime/bills.
- Use the existing design system and components. No new visual style.

**Accept:** two browsers (two X accounts), full loop: A pays @B who has never signed in → B signs in → B's account exists with one key → B sees the money → A's activity flips from "Waiting" to "Claimed".

### 6.5 P0-e: fix the copy (judges and AI screeners will read it)

`frontend/src/components/landing/Faq.tsx`, in NEAR mode:

- "Where is my money actually kept?" → "In your own NEAR account, named after your X handle. Its only key is yours, created when you signed in. Selkie holds no key to it. Check it yourself on the explorer."
- Add: "What can Selkie do with money waiting for me?" → "Only one thing: release it to the account of the person who signs in with that X account. It can't take it, change the amount, or stop the sender's refund."
- Keep "Nothing to write down" only if Spike A passed (Privy wallet). If the fallback device key is used, change it honestly.

### 6.6 Environment (add to .env.example, values never committed)

```
SELKIE_CHAIN=near
NEAR_NETWORK=testnet
NEAR_RPC_URL=                    # verify a current public RPC
NEAR_ROOT_ACCOUNT=selkiepay.testnet
NEAR_HANDLE_PARENT=x.selkiepay.testnet
NEAR_HANDLE_PARENT_KEY=          # secret
NEAR_RELAYER_ACCOUNT=relayer.selkiepay.testnet
NEAR_RELAYER_KEY=                # secret
NEAR_ORACLE_ACCOUNT=oracle.selkiepay.testnet
NEAR_ORACLE_KEY=                 # secret, function-call key on escrow.claim
NEAR_ESCROW_CONTRACT=escrow.selkiepay.testnet
NEAR_USDC_CONTRACT=              # testnet: real if available, else usdc.selkiepay.testnet
NEAR_NEW_ACCOUNT_DEPOSIT=        # yoctoNEAR sent to each new account for storage
SELKIE_CLAIM_LIFETIME_SECS=2592000
ONECLICK_API_URL=https://1click.chaindefuser.com
ONECLICK_JWT=                    # optional, from partners.near-intents.org
X_BEARER_TOKEN=                  # optional, enables X-ID recipient keys
# frontend/.env.local
NEXT_PUBLIC_SELKIE_CHAIN=near
NEXT_PUBLIC_NEAR_NETWORK=testnet
NEXT_PUBLIC_NEAR_EXPLORER=       # verify testnet explorer base URL
```

## 7. P1 and P2 (only after P0 is fully green)

### 7.1 P1-a: NEAR Intents (1Click) — any chain in, any chain out

- Always fetch asset IDs from `GET /v0/tokens`. Never construct them.
- Add money (on-ramp from another chain): quote with `originAsset` = user's pick (e.g. USDT on Tron, USDC on Base), `destinationAsset` = USDC on NEAR, `recipient` = user's NEAR account, `recipientType` = destination chain, a refund address the user enters, `dry: false` → show `depositAddress` with QR, poll status until SUCCESS / REFUNDED / FAILED. Show each status plainly.
- Cash out: quote USDC on NEAR → user's chosen asset and external address. The deposit is a USDC ft_transfer to the quote's deposit address, signed by the user through prepare → relay (5.5 allows it only for a live quote).
- Testnet: show `dry: true` quotes only, with a clear "mainnet only" label.
- P1-c (mainnet, needs human OK): one real run of a few dollars for the video. Record tx hashes in PROGRESS.md.

### 7.2 P1-b: Pay many + DAO payouts (opens the social track)

- PayManyPanel in NEAR mode → one `ft_transfer_call` with `hold_many`. Recipients already on Selkie are claimed by the oracle right away, so one flow covers everyone.
- `scripts/near/dao-payout.ts`: read a CSV of `@handle,amount`, resolve recipient keys, and create a Sputnik DAO proposal (FunctionCall on USDC `ft_transfer_call` to the escrow with a `hold_many` msg). Council approves in the DAO UI; on execution, money waits for each handle. Look up the testnet Sputnik factory in the sputnik-dao-contract repo; do not guess.
- Demo line: "A community treasury paid five contributors by X handle. Two had never used NEAR. They signed in and it was theirs."

### 7.3 P2-a: X bot in NEAR mode

- Cheapest safe version first: "@SelkiePay send $5 to @amaka" → bot replies with a Selkie link that opens Send prefilled; the user confirms and signs. The bot never spends.
- Bot pocket (only if time remains): users fund a capped pocket in the escrow (`ft_transfer_call` msg `{"kind":"pocket","daily_cap":"..."}`); a bot account with a function-call key can call `pocket_send(owner, recipient, amount)` only from that owner's pocket, only up to the daily cap; owner can `pocket_withdraw` any time. A compromised bot can spend at most the pocket.

### Cut list (do not build)

Convert (Stellar DEX), payment requests, Telegram, airtime/bills, naira off-ramp, multi-device key recovery beyond what Privy gives, the /pitch page, mainnet launch beyond the one demo run.

## 8. Checkpoints (Lagos time, deadline Sat 00:59)

| When | Must be true |
| --- | --- |
| Wed 22:00 | Setup done; Spike A and Spike B reported |
| Thu 12:00 | Escrow contract + tests green and deployed on testnet (6.1) |
| Thu 18:00 | Full web loop on testnet (6.4 acceptance). The human decides about a second hackathon project at this point, so report status honestly. |
| Fri 12:00 | P1 done or cut; hosted demo up (Vercel + Railway configs already exist; the human handles accounts); README draft |
| Fri 18:00 | README final, video recorded, `docs/hackathon/SUBMISSION.md` ready for the human |
| Fri 21:00 | Human posts on X and submits. Saturday 00:59 is the hard stop. |

If you are behind at a checkpoint: cut from P1/P2 first, never from P0, and say so in PROGRESS.md.

## 9. Deliverables for judging

### 9.1 README (rewrite the top of README.md on the `near` branch)

Keep the Stellar sections below a clear divider. Top of file:

- **Selkie — send money to any X handle, on NEAR.** One paragraph: problem → what it does.
- Demo video link + hosted app link.
- **Try it in 5 minutes** (do X, see Y): numbered steps on the hosted app, e.g. "1. Sign in with X. You see `<you>.x.selkiepay.testnet` and 'Keys: 1 — yours'. 2. Tap Faucet. You see 10.00 USDC. 3. Send 1.00 to @selkie_demo_b. You see 'Waiting for @selkie_demo_b'..." Include test accounts if the human provides them.
- **Run it locally:** exact commands, from a fresh clone, including `scripts/near/setup-testnet.ts`.
- **What's new at NEAR HACKATHON:** the five points from section 0, each with the file that implements it, and the diff link `compare/pre-hackathon...near`.
- **Why NEAR:** named accounts, multiple keys per account (we add exactly one, theirs), NEP-366 meta-transactions, NEP-141 `ft_transfer_call` escrow, NEAR Intents.
- **Trust model** table (5.6) and limitations (oracle trust, Privy custody, testnet, naira off-ramp not built).
- **Contracts and accounts** table with testnet explorer links.
- **Tests:** commands and what they prove.
- **Disclosure:** Selkie existed on Stellar before the hackathon (tag `pre-hackathon`); NEAR work listed above was built during it; libraries used; AI coding tools used.
- **Other NEAR HACKATHON entry by the same builder:** ask the human.

### 9.2 Proof script

`npm run prove:keys -- <accountId>` prints the account's access keys and states whether any Selkie-held key is among them. Use its output in the README and the video.

### 9.3 Demo video script (about 2 minutes, the human records)

- (0:00) "To pay someone in crypto you need their address. Most people don't have one."
- (0:10) Sender pays @friend $2. Friend has never used NEAR. "Waiting for @friend."
- (0:30) Friend opens Selkie on their phone, signs in with X. Their account `friend.x.selkiepay.testnet` appears with $2.
- (0:55) Explorer: one access key, created on the friend's sign-in. Selkie holds none. Run `prove:keys` on screen.
- (1:15) Add money from another chain or cash out (mainnet clip, if P1-c ran).
- (1:35) Pay many / DAO payout (if 7.2 shipped).
- (1:50) "Built at NEAR HACKATHON."

### 9.4 `docs/hackathon/SUBMISSION.md` (drafts for the human; do not submit)

- Project name, one-line description.
- Tracks: realworld (+ social / agents only if shipped).
- Repo link, hosted demo link.
- "What did you build?" text, 20 to 2000 characters: problem, implementation, NEAR's concrete role.
- X post draft: hook line, "Built at NEAR HACKATHON", @NEARProtocol, #NEARHackathon, video, repo and demo links.
- A checklist: repo public, LICENSE present, README steps tested from a fresh clone, hosted demo up through 2026-11-25, video attached to the X post, NEAR mainnet payout address ready (the human provides it).

## 10. Verify, don't guess (look these up and record answers in PROGRESS.md)

- Privy: extended-chains import path, NEAR `chainType` value, raw-sign hash format, and how the server reads a user's NEAR wallet public key.
- near-api-js (or near-kit) current version and its delegate-action helpers (build, encode/hash with NEP-461 prefix, signed delegate encoding, relayer submit).
- near-sdk (Rust) current version and cargo-near build/deploy commands.
- Testnet RPC URL and testnet explorer URL.
- Whether real USDC exists on NEAR testnet (check faucet.circle.com). Mainnet USDC contract ID (read it from 1Click `/v0/tokens`, don't copy it from memory).
- USDC `storage_balance_bounds` (how much storage_deposit costs).
- Account-id validation rules and the cost of creating an account with one key.
- 1Click endpoints, request fields, status values, and whether a JWT is needed.
- Testnet Sputnik DAO factory account and proposal format (7.2 only).
- X API v2 user-lookup-by-username endpoint and auth (5.3).

## 11. Glossary

- **Handle account:** `name.x.selkiepay.testnet`, created when an X user first signs in; its only key is theirs.
- **Recipient key:** 32-byte hash the escrow holds money for (5.3).
- **Hold:** money sent to someone who isn't on Selkie yet, waiting in escrow.
- **Claim:** the oracle releasing held money to the proven owner's account.
- **Prepare → sign → relay:** backend says exactly what to sign, the browser signs with the user's Privy key, the relayer pays gas and submits.
- **1Click:** NEAR Intents API for cross-chain deposits and withdrawals.
