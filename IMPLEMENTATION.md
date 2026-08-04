# Getting to MVP

Where Selkie is, what is left, and the order to do it in.

The MVP is five boxes:

1. Sending money via X
2. Automatic creation of wallet
3. Sign in to app with X account
4. Sign in normally, and a way to link X and Telegram
5. On-ramp and off-ramp — **deliberately last, not covered until Phase 5**

## Where we are

**182 tests passing**, typecheck and lint clean across every workspace, the web
app building, and the escrow contract deployed on testnet
(`CBQ54MQWSN32HX26QG2IJ2OFD2IKJBAPAHTDTV43TDUOSQWMO4V2CX5Y`).

| # | Box | State |
| --- | --- | --- |
| 1 | Sending money via X | **Half.** Sending *to* an X handle works end to end. Sending *from* X needs the bot, and `backend/bot` is still a README. |
| 2 | Automatic wallet creation | **Built, but the keys do not survive a restart.** See B1. |
| 3 | Sign in with X | **Done.** |
| 4 | Sign in normally + link X and Telegram | **Done.** |
| 5 | On/off-ramp | Not started, by choice. |

---

## Done

### Telegram, everywhere a handle is taken — box 4

The backend already understood Telegram; the frontend never asked. It does now:
Telegram is a login method, `linkTelegram` sits beside `linkX`, and Send, Ask
and Pay-many all carry a platform.

The reason it is more than a dropdown: **`@amaka` on X and `@amaka` on Telegram
are different people.** The escrow hashes `"<platform>:<username>"`, so paying
the wrong one pays a stranger, permanently. So the platform travels with the
handle everywhere, including into the activity feed — a "recently paid" chip
that restored only the name would quietly send the repeat payment to the wrong
person. `HistoryEntry.counterpartyHandle` exists for exactly that.

Six tests cover it, including the one that matters: the two `@amaka`s resolve to
different accounts, and a request addressed to one is invisible to the other.

### Refunds — money is never stuck

The contract had `refund(id)` and the adapter wrapped it, but nothing called it.
A payment to a handle that never joined sat there forever.

The escrow's payment id was already coming back as `PaymentResult.claimRef` and
being thrown away. It is now recorded on the send, alongside `refundableAt`, and
`POST /payments/:claimRef/refund` returns the money. The feed grows a **Take it
back** button the moment the wait is over, and the row becomes "Back with you".

One payment stays one line. A second "refund" entry would double-count money
that only moved once.

### The feed tells the truth

`ActivityStore` had `record` and `list` and no way to change anything, so a send
marked `pending` stayed pending forever — including after the recipient signed in
and the money landed. `ClaimOutcome` now carries the released payment ids, and a
claim settles the **sender's** side too.

A payment already taken back is never re-marked as delivered. There is a test.

### A double-tap cannot send twice

`Idempotency-Key` on every money route. The key is minted where the *intent* is
formed — when a confirm screen opens — not inside `send()`, because a
double-tap would otherwise produce two different keys and defeat the whole
thing. Where a stable id already exists (a request, an escrowed payment) that id
is the key.

Wrapped around the money, never around validation: a payment refused for a bad
amount must succeed once the amount is fixed.

### Rate limits, and a body limit

`/handles/:username` was an unmetered handle-enumeration oracle. Now: 300/min
globally, 60 on handle lookups, 30 on auth and on anything that moves money,
keyed per signed-in user rather than per IP so one office does not throttle
itself. Bodies cap at 128 KB (413 above that).

Two bugs surfaced while testing this, which is the argument for the test:

- `capped(LIMITS.handles)` passed the constant, so every override was silently
  ignored. It takes the name now and reads the merged config.
- The custom error handler turned the limiter's 429 into a 500 — telling the
  caller "our fault" about a problem that was theirs. Fastify's own 4xx refusals
  now pass through with their own status.

Verified live: 60 lookups through, then 429; a 200 KB body gets 413.

### Live balances

Nothing polled, so money arriving while you watched the screen did not appear.
`/me` every 15s while the tab is visible, paused when hidden and caught up on
return.

### Everything survives a restart — B2

SQLite, at `SELKIE_DB_PATH`. Five stores on disk: users and identities, activity,
requests, the handle→address directory, and idempotency keys. The schema applies
itself on boot and is all `IF NOT EXISTS`, so there is no migration step.

The `PRIMARY KEY (provider, subject)` on identities is the interesting one: that
constraint *is* the "one identity belongs to one account" rule the whole account
model rests on. It used to live in a `Map`.

**The entire API suite now runs twice, once per backend** — in memory and
SQLite, 157 tests either way. That immediately paid for itself: the two
disagreed on handle order, and the in-memory side was wrong. `addIdentity` was
moving a re-linked identity to the *end* of the list, and since every sign-in
re-links every identity, your first handle — the one payments are sent **from** —
could change between logins depending on what order Privy answered in. It now
refreshes in place on both sides.

Seven more tests use a real file: write, close, reopen, and check it is all
still there. Verified live too — seeded an account, restarted the API, and it
came back.

What is *not* fixed by this is B1. Wallet keys are still generated in memory and
thrown away.

### Authentication stopped being a write

`requireUser` used to call `signIn`, which meant every authenticated request did
a round trip to Privy, wrote to the identity table, and read the escrow contract
once per handle. Three consequences, and the third was a bug:

- Privy having a bad ten minutes meant nobody could read their balance.
- Every request carried Privy's latency plus a chain read.
- **A plain `GET /activity` could release escrowed money and record nothing** —
  no entry in the recipient's feed, and the sender's side still saying "Waiting"
  long after the money had gone. A test now pins this.

Split in two. `authenticate` verifies the token's signature locally — which
`subjectOf` already did — and looks the user up in our own database. No network,
no writes, no side effects. `signIn` stays as the deliberate act and is reached
only from `/auth/session` and `/auth/link`.

That needed the provider's own account id, which was being discarded.
`provider_accounts` maps it to a user, **many-to-one on purpose**: somebody who
signed up twice and then merged has two logins and one wallet, and both have to
keep working. Without that, the login they used first would resolve to a deleted
user and they would be offered a third wallet — the exact failure the account
model exists to prevent. Tested.

### Money that arrives while you are looking at the screen

Sign-in collects what the escrow is holding. But money can land a minute later,
and nothing was watching: it would show up at the next login, hours later, with
no explanation for the delay.

`ClaimWatcher` reads the contract's own `deposit` events on a timer — **one RPC
call for the whole system**, not one read per user per request. A deposit for a
handle nobody has claimed yet is left alone, because that money is waiting for
someone who has not arrived and their sign-in already knows how to collect it.

The chain only sees `sha256("<platform>:<username>")` and a hash does not run
backwards, so `handle_index` records what each hash means as handles become
known. The cursor is saved only after a batch is fully handled: a crash replays
it, and collecting twice finds nothing waiting, whereas advancing early loses
deposits until the next sign-in.

Verified against the deployed testnet contract — it polls cleanly, persists a
cursor, and resumes across a restart rather than rescanning.

On the UI side the feed and the requests badge now refresh alongside the
balance. A balance that changes with no matching line in the feed reads as a
glitch.

### Housekeeping

`docs/devnet.md` is gone — it documented Canton DevNet and cBTC and had nothing
to do with this codebase. `docs/deploy.md` is rewritten for the real stack:
contract, then Railway, then Vercel, with the security checklist that follows
from what actually holds money.

---

## Left: one blocker

### B1. User wallet keys live in RAM and are discarded

`backend/api/src/index.ts`:

```ts
createSigner: async () => {
  const { signer } = KeypairSigner.generate();   // `secret` is thrown away
  signers.add(signer);                            // into an in-memory Map
  return signer;
},
```

**Restart the API and every wallet Selkie provisioned becomes unspendable
forever.** The money stays on the ledger, visible, permanently unreachable.

`backend/api/README.md` currently claims *"Selkie never holds a user's private
key."* Today that is false, and it stays false until this is fixed — which is
why the sentence has not been edited to match: the code should move, not the
claim.

Privy does support Stellar. `@privy-io/api-types` has
`ExtendedChainType = 'cosmos' | 'stellar' | ...`. But the React SDK cannot create
one — its `CustodialWalletChainType` is `'ethereum' | 'solana'` only — so it is a
**server-side** call. Which explains a quiet bug: `walletAddress()` looks for a
linked account with `chain_type === "stellar"` and always gets `null`, so every
user has always fallen through to the in-memory keypair. That path has never
executed.

`signer.ts` was written for this: *"Tomorrow that should be Privy embedded
wallets... a new Signer implementation and nothing else."*

**The plan**, decided: Privy server-side wallets.

- Add `@privy-io/server-auth` to `backend/api`.
- `PrivyIdentityProvider.createWallet(subject)` → POST a Stellar wallet, called
  from `IdentityService.#addressFor` *before* the `ensureAccount` fallback.
- `PrivySigner implements Signer` in `packages/chain-stellar/src/signer.ts`,
  delegating to Privy's raw-sign endpoint, plus a `PrivySignerProvider` that
  resolves an address to its wallet id.
- Delete the `createSigner` fallback. `KeypairSigner` stays for the sponsor and
  the oracle, which are operator keys, not user keys.
- A `walletAddress()` that returns null becomes a **hard failure** at sign-up
  rather than a silent downgrade to a key we cannot keep.

**Blocked on:** confirming Stellar wallets are available on the Privy plan.

**Migration:** anyone who signed up before this ships has an orphaned address.
On testnet, wipe and start over.

**Definition of done:** create an account, send money, restart the API, sign back
in, same wallet, same balance. Everything except the wallet key already does
this.

---

## Then

### The X bot — box 1

The last unbuilt box, and the one that carries the promise. Someone paid before
they join **has no way to find out** — the money waits 30 days and expires.
"Money that finds people" needs something to go and tell them, and the reply
tweet is both the notification and the acquisition loop.

**Decide first: how a bot-initiated payment authenticates.** The API takes a
Privy bearer token and a tweet has no token. A service key plus
`POST /payments/send-as` is a Saturday's work and means that key can move
anyone's money; scoping it to users who have already linked X in the app is
right. This is the one place where the shortcut becomes a vulnerability.

### Smaller things

- Retry `ensureReceivable`, and alert when the sponsor's XLM runs low — every
  sign-up spends it, and running dry breaks account creation for everyone at
  once with nothing to say so.
- A nightly sweep that offers refunds automatically, so nobody has to know the
  feature exists.
- Structured logging with a request id. `console.error` is the whole
  observability story.
- Send by pasting a tweet URL. Removes the last chance to mistype a handle.
- An email or push when money is waiting, not just the bot reply.

### Ship

Deploy per `docs/deploy.md`, move the sponsor and oracle keys into the host's
secret store, rotate the testnet keys before mainnet, wire `/health` into the
platform check, and turn on uptime alerting.

### Phase 5 — on-ramp and off-ramp (box 5)

Deferred. On-ramp: card → USDC to the user's Stellar address; MoonPay and Ramp
both cover it, and Privy ships a funding flow already in the bundle. Off-ramp is
harder and regional — Nigeria means a local partner and KYC. Both belong behind
`packages/core/src/services/ramp.ts`, which already exists as an interface.
