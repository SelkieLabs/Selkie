# Getting to MVP

Where Selkie actually is, what is left, and the order to do it in.

The MVP is five boxes:

1. Sending money via X
2. Automatic creation of wallet
3. Sign in to app with X account
4. Sign in normally, and a way to link X and Telegram
5. On-ramp and off-ramp — **deliberately last, not covered until Phase 5**

## Where we are

Green across the board on the things that are built: **82 tests passing**,
typecheck clean on every workspace, the escrow contract deployed and proven on
testnet (`CBQ54MQWSN32HX26QG2IJ2OFD2IKJBAPAHTDTV43TDUOSQWMO4V2CX5Y`), the API and
the web app running end to end.

| # | Box | State |
| --- | --- | --- |
| 1 | Sending money via X | **Half.** You can send *to* an X handle from the web app, escrow and all. You cannot send *from* X. `backend/bot` is a README and nothing else. |
| 2 | Automatic wallet creation | **Built, but the keys do not survive a restart.** See B1. |
| 3 | Sign in with X | **Done.** |
| 4 | Sign in normally + link X and Telegram | **X done. Telegram is missing in the frontend only** — the entire backend already handles it. |
| 5 | On/off-ramp | Not started, by choice. |

So the honest headline: the product works, and **it is one `Ctrl-C` away from
destroying every wallet it has created.** That is the first thing to fix, and
none of the feature work below matters until it is done.

---

## Phase 0 — Stop losing money

Two blockers. Neither is a feature. Both make the difference between a demo and
something a person can put $20 into.

### B1. User wallet keys live in RAM and are discarded

`backend/api/src/index.ts`:

```ts
createSigner: async () => {
  const { signer } = KeypairSigner.generate();   // `secret` is thrown away
  signers.add(signer);                            // into an in-memory Map
  return signer;
},
```

`KeypairSigner.generate()` returns `{ signer, secret }` and the secret is
dropped on the floor. The keypair exists only inside `InMemorySignerProvider`.
**Restart the API and every wallet Selkie provisioned becomes unspendable
forever.** The money is still on the ledger, visible, and permanently
unreachable.

It is worth being blunt that `backend/api/README.md` currently claims *"Selkie
never holds a user's private key."* Today that is false — Selkie holds every one
of them, badly.

The intended path is already written into the code. `signer.ts` says:

> Today the backend holds keys for accounts it provisions. Tomorrow that should
> be Privy embedded wallets or device passkeys... That upgrade is meant to be a
> new Signer implementation and nothing else.

And Privy does support Stellar — I checked the installed types.
`@privy-io/api-types` has `ExtendedChainType = 'cosmos' | 'stellar' | ...` and
`CurveSigningChainType` includes `stellar`. The catch is that the **React SDK
cannot create one**: its `CustodialWalletChainType` is `'ethereum' | 'solana'`
only. Stellar wallets are a **server-side** API call.

Which explains a quiet bug: `PrivyIdentityProvider.walletAddress()` looks for a
linked account with `chain_type === "stellar"`, and with the current setup that
is always `null`. Every user silently falls through to the in-memory keypair. The
Privy path has never once executed.

**Do this:**

- [ ] Add `@privy-io/server-auth` to `backend/api`.
- [ ] In `PrivyIdentityProvider`, add `createWallet(subject)` → POST a Stellar
      wallet via Privy's wallet API. Call it from `IdentityService.#addressFor`
      *before* the `ensureAccount` fallback.
- [ ] New `PrivySigner implements Signer` in `packages/chain-stellar/src/signer.ts`
      — `address` from the Privy wallet, `sign()` delegating to Privy's raw-sign
      endpoint. This is the whole point of the interface; nothing above it moves.
- [ ] New `PrivySignerProvider implements SignerProvider` that resolves an
      address to its Privy wallet id.
- [ ] Delete the `createSigner` fallback in `index.ts`. Keep `KeypairSigner`
      strictly for the sponsor and oracle, which are operator keys, not user keys.
- [ ] Make `walletAddress()` returning `null` a **hard error** on account
      creation rather than a silent downgrade. Failing to create a wallet should
      fail the sign-up, loudly.

**Migration:** anyone who signed up before this ships has an orphaned address.
On testnet, wipe and start over. Write it down now so nobody wonders later.

### B2. Nothing is persisted

Four in-memory stores, all restart-fatal:

| Store | Loses |
| --- | --- |
| `InMemoryUserStore` | every account and identity link |
| `InMemoryActivityStore` | every feed entry |
| `InMemoryRequestStore` | every pending request |
| `InMemoryAccountDirectory` | which handle owns which address |

The design already anticipated this — each is an interface with a docstring
naming Postgres. This is filling in blanks, not redesigning.

**Do this:**

- [ ] Postgres + a thin query layer. No ORM; these are four tables.
- [ ] `PostgresUserStore`, `PostgresActivityStore`, `PostgresRequestStore`,
      `PostgresAccountDirectory`. One class per interface, one changed line each
      in `index.ts`.
- [ ] A `UNIQUE` index on `(provider, subject)` for identities. That constraint
      *is* the "one identity belongs to one user" rule that `IdentityService`
      depends on; leaving it to application code invites the two-wallet bug the
      whole account model exists to prevent.
- [ ] Keep every in-memory implementation. The 82 tests run against them and
      should stay fast.

**Definition of done for Phase 0:** create an account, send money, restart the
API, sign back in, and see the same wallet with the same balance.

---

## Phase 1 — Close the MVP boxes

### 1.1 Telegram linking — box 4 (smallest job on this page)

The backend is entirely finished. `PROVIDER_BY_PRIVY_TYPE` maps `telegram`,
`isPayable` includes it, `parseHandle` handles it, `/handles/:username?platform=telegram`
works today. The frontend simply never asks.

- [ ] `frontend/src/app/providers.tsx` — add `"telegram"` to `loginMethods`.
- [ ] `frontend/src/contexts/AuthContext.tsx` — add `linkTelegram: () => privy.linkTelegram()`
      next to the existing `linkX`.
- [ ] `Prompts.tsx` — `LinkHandleBanner` should offer both, not just X.
- [ ] `SendPanel` — a platform toggle. The API already takes `platform`; the UI
      hardcodes `x`.
- [ ] Enable Telegram as a login method in the Privy dashboard.

Half a day, and it ticks a box.

### 1.2 The X bot — box 1

The one genuinely unbuilt thing, and it is the box that carries the product's
whole promise. Right now, someone paid before they join **has no way to find
out**. The money sits in escrow for 30 days and expires. "Money that finds
people" only works if something goes and tells them.

Build `backend/bot` as a thin surface. It parses and calls the same API the web
app calls — no chain code, no second copy of the rules.

- [ ] `backend/bot/package.json`, X API v2 client, long-poll mentions.
- [ ] Parse `@SelkiePay send 5 to @ada`. Amount, asset, recipient, that is all.
      Reject anything ambiguous rather than guessing at a number.
- [ ] Map the mentioning X user id → Selkie user. **Reuse `IdentityService`;
      never key on the @handle string.**
- [ ] The reply is the product: *"Sent. @ada, $5 is waiting for you — sign in at
      selkie.app to claim it."* That single tweet is the acquisition loop.
- [ ] DM the recipient too where the API allows it.
- [ ] Rate-limit per sender. A public trigger for moving money needs a ceiling.

**Open question worth deciding before writing code:** how does a bot-initiated
send authenticate? The API takes a Privy bearer token, and a tweet has no token.
Two options:

- a service-to-service key on the bot, plus a `POST /payments/send-as` that takes
  a verified X user id — simple, but that key can move anyone's money
- the bot only accepts commands from users who have already linked X in the app,
  and sends on their behalf via a scoped grant

Second is right. First is a Saturday. **Pick deliberately** — this is the one
place in the codebase where a shortcut becomes a vulnerability.

### 1.3 Refunds — money must never be stuck

`escrow.rs` has `refund(id)` and `escrow.ts` wraps it. **No API route calls it,
and no UI exposes it.** A payment to a handle that never joins expires after 30
days (`THIRTY_DAYS` in `config.ts`) and then sits there forever.

The contract comment says it best: *"Anyone's money can wait, but nobody's money
can be stuck."* Right now it is stuck.

- [ ] `POST /payments/:ref/refund`, sender only, after expiry.
- [ ] Surface unclaimed sends in the activity feed with the date they can be
      taken back.
- [ ] A nightly sweep that offers refunds automatically, so nobody has to know
      the feature exists.

### 1.4 Automatic wallet creation, finished — box 2

Box 2 is genuinely built (lazy provisioning, sponsored reserves, no XLM ever
touched by a user) and becomes real once B1 lands. Two things to add:

- [ ] Retry `ensureReceivable` on failure. A sponsor with no XLM fails silently
      into an address that bounces money back.
- [ ] Alert when the sponsor balance drops below a threshold. Every sign-up
      spends the sponsor's XLM; running dry breaks account creation for everyone
      at once, and there is currently nothing that would tell you.

---

## Phase 2 — Make it trustworthy

Not features. The difference between working and dependable.

- [ ] **Idempotency keys on every money route.** There are none. A double-tap or
      a network retry on `/payments/send` sends twice. `Idempotency-Key` header,
      stored with the result, replayed for 24h.
- [ ] **Settle the activity feed.** `ActivityStore` has `record` and `list` and
      no `update`. A send marked `pending` stays `pending` forever, even after
      the recipient claims. Add `update`, and mark the sender's entry confirmed
      when the claim lands.
- [ ] **Rate limits.** `@fastify/rate-limit`, plus a body limit. `/handles/:username`
      is currently an unmetered handle-enumeration oracle, and `/payments/batch`
      will happily accept 100 recipients as fast as you can ask.
- [ ] **Live balances.** Nothing polls. Money arriving while you look at the
      screen does not appear. Poll `/me` every 15s while the tab is visible —
      cheap, and it makes the app feel alive.
- [ ] **Structured logging** with a request id. `console.error` is the entire
      observability story today.
- [ ] **API tests for the money routes.** 82 tests is good coverage of identity
      and amounts; `app.test.ts` should grow send, batch, requests and refund.

---

## Phase 3 — Better than the brief

Small things that decide whether people come back.

- [ ] **Recipient sees it coming.** An email or push when money is waiting, not
      just the bot reply.
- [ ] **Send by pasting a tweet URL.** Extract the handle. Removes the last
      chance to mistype.
- [ ] **Repeat payments.** The activity feed already knows who you have paid; one
      tap to pay them again.
- [ ] **A real empty state on `/wallet/activity`.** First-run should teach, not
      show an empty list.
- [ ] **Delete or rewrite `docs/devnet.md`.** It documents Canton DevNet and cBTC
      and has nothing to do with this codebase any more. It will confuse whoever
      reads it next, which will eventually be you.

---

## Phase 4 — Ship it

- [ ] Deploy the API (Railway) and the web app (Vercel), `SELKIE_API_ORIGIN`
      pointed at the API.
- [ ] Move the sponsor and oracle keys into the host's secret store. Rotate the
      testnet keys before mainnet, and never reuse them.
- [ ] Rewrite `docs/deploy.md` — it still describes `web-vite/` and a Canton
      repo layout that does not exist here.
- [ ] `/health` into the platform's health check. The route exists; nothing uses it.
- [ ] Uptime and error alerting.

---

## Phase 5 — On-ramp and off-ramp (box 5)

Deferred. Sketched only so the shape is on record.

- On-ramp: card → USDC into the user's Stellar address. MoonPay and Ramp both
  cover Stellar USDC. Privy also ships a funding flow (`FiatOnrampScreen` is
  already in the bundle) — cheapest integration if the coverage fits.
- Off-ramp: harder, and regional. Nigeria means a local partner and KYC.
- Both belong behind `packages/core/src/services/ramp.ts`, which already exists
  as an interface. Keep provider code out of the payment path.

---

## Order, and why

```
Phase 0  ██████████  blocking. nothing ships without it.
  B1 wallet custody          ~3 days
  B2 persistence             ~2 days

Phase 1  ████████    the MVP boxes
  1.1 telegram link          ~0.5 day   ← do this first, it is free
  1.3 refunds                ~1 day
  1.4 wallet hardening       ~1 day
  1.2 X bot                  ~4 days    ← biggest, decide auth first

Phase 2  ██████      trustworthy       ~4 days
Phase 3  ███         better            ~3 days
Phase 4  ██          ship              ~2 days
Phase 5  ─           ramps             later
```

Roughly **three weeks** to a defensible MVP, most of it in Phase 0 and the bot.

Do Telegram linking first anyway. It is half a day, it ticks box 4, and shipping
something on day one while the custody work is still in progress is good for
morale.

## The one decision to make now

**How the X bot authenticates a payment.** It changes the API surface, it is the
only place where a shortcut turns into "anyone can move anyone's money", and
Phase 1.2 cannot start without an answer. Everything else on this page is
execution.
