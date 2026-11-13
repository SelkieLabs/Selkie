# Selkie: send money to any X handle, on NEAR

To pay someone in crypto you need their address, and most people don't have
one. With Selkie you pay **@amaka** instead. If Amaka has never used NEAR, the
dollars (USDC) wait in an escrow contract. When they sign in with that X
account, they get a real NEAR account named after their handle,
`amaka.x.selkiepay.testnet`, and the money moves into it. Its only key is theirs.
Selkie pays every network fee and holds no key to anyone's account.

You can also pay from a tweet. "@SelkiePay send 2 to @amaka" pays on the spot
from a small pocket you fill once, with a daily limit the chain enforces. And
you can take money out to another chain, or to a bank account in Nigeria,
Kenya, Uganda or Tanzania.

Built at **NEAR HACKATHON**. Tracks: realworld (primary), agents (the X bot
pays from a capped on-chain pocket), social (DAO payouts by X handle). It runs
on NEAR testnet. The mainnet setup is written and waiting, see [Mainnet](#mainnet).

- Demo video: _link added at submission_
- Hosted app: https://selkiepay.com
- Docs: https://selkiepay.com/docs
- X bot: [@SelkiePay](https://x.com/SelkiePay)

## Check it in 2 minutes, no setup

1. Run `git clone https://github.com/SelkieLabs/Selkie && cd Selkie && npm install`.
2. Run `npm run prove:keys -- selkiepay.x.selkiepay.testnet`. You see
   `Keys 1 on chain`, then `Result Selkie holds no key to this account.` The
   script reads the account's keys from the chain, then reads every key on every
   account Selkie runs (root, account creator, relayer, oracle, escrow), and checks
   whether the two lists overlap. It needs no secrets and no Selkie server.
3. Open https://explorer.testnet.near.org/accounts/selkiepay.x.selkiepay.testnet.
   You see the same single full-access key.
4. Open https://explorer.testnet.near.org/accounts/pocketbot.selkiepay.testnet.
   This is the X bot's account. Its only key is a function-call key that can call
   `pocket_send` on `pocket.selkiepay.testnet` and nothing else.
5. Run `npm test`. You see `# pass 548`, `# fail 0`. Tests that need Postgres skip
   when `DATABASE_URL_TEST` is unset.
6. Run `npm run test:contracts:near` (needs Rust). You see
   `test result: ok. 35 passed` for the escrow, then `test result: ok. 34 passed`
   for the pocket.

## Try it on the hosted app

1. Open https://selkiepay.com and sign in with X. You see your account,
   `<your handle>.x.selkiepay.testnet`, and the line "Keys on this account: 1 —
   yours. Selkie holds none." with a link to the explorer.
2. Tap **Receive**, then **Open the faucet**. On faucet.circle.com pick NEAR Testnet
   and paste your account name. Within a minute your balance goes up, and the
   feed shows a line "from outside Selkie".
3. Tap **Send**, type a handle that has never used Selkie, and send `1.00`. A
   confirm window lists what you are about to sign. After you say yes, you see
   "Sent. It is waiting for @them to claim." and a "Waiting" line in your feed.
   Type a NEAR account into the handle box instead and Selkie stops you and
   offers to pay it as an address, so money never waits for a name no X account
   can sign in as.
4. That person signs in with X on their phone. Their account is created with
   their key as its only key, and the `1.00` is in it. On your side, the
   "Waiting" tag leaves that feed line.
5. If nobody claims a payment before it expires, its feed line gets a
   **Take it back** button. Only the sender's own key can sign that refund.
6. Open **Tweet to pay** and fill your pocket with `1.00`. You sign one
   `ft_transfer_call`, and you see the pocket's balance and what is left today
   (10.00 unless you set another daily limit).
   Now tweet `@SelkiePay send 0.10 to @<someone on Selkie>`. Within about a
   minute the bot replies "✅ Sent 0.10 USDC to @them ⚡ Straight from your Selkie
   pocket" with an explorer link to the `pocket_send`.
7. Tap **Cash out**. Pick **A bank account**, a country and a bank, and type an
   account number. You see the account holder's name (Paycrest checks it), the
   rate, and what arrives in your currency, marked "Preview: sending works on
   mainnet". Pick **Another chain** instead and
   you see a live NEAR Intents price for USDC or USDT on that chain.

## The X bot

Tweet at [@SelkiePay](https://x.com/SelkiePay). It reads mentions every 15
seconds or so and replies in the thread.

| Tweet | What happens |
| --- | --- |
| `@SelkiePay send 5 to @amaka` | If you have a pocket and @amaka is on Selkie, it pays from your pocket on the spot and replies with the explorer link. Otherwise it replies with a link that opens Send filled in; you check it and sign with your own key. If @amaka has not joined, that payment waits for them in the escrow. |
| `@SelkiePay send 5 to @amaka for lunch` | The same. The note travels with the payment and is the on-chain memo of a pocket send. |
| `@SelkiePay request 5 from @amaka` | The ask is made on the spot, no link to click. @amaka finds it under Requests with a Pay button when they open Selkie (or sign in with X for the first time), and nothing moves until they pay it. |
| `@SelkiePay balance` or `activity` | "🔒 That one stays private" and a link to your wallet. A public reply never shows anyone's money. |
| `@SelkiePay help` | The list of commands. |

When a pocket send can't go, the reply says why and gives the way on: no
pocket yet (a link that opens the pocket top-up already filled in), not enough
in the pocket (how much is left, and a top-up link), over today's limit (how much
is left today), or the person isn't on Selkie yet. That last reply says so, gives
you the Send link to sign (a pocket only pays Selkie accounts), and tells them,
tagged in the thread, that once you sign it waits for them until they sign in
with X.

What the bot can't do, and where that is enforced:

- **Spend from your account.** It can only spend from a pocket you filled
  yourself. The pocket contract checks this
  ([`contracts-near/pocket`](contracts-near/pocket/src/lib.rs)).
- **Go over your limit.** At most your daily limit per UTC day (10 USDC unless you
  change it). Setting it to 0 pauses the bot for your pocket. Checked on chain.
- **Pay an address of its choice.** It can only pay `*.x.selkiepay.testnet`
  accounts, which exist only for people who proved an X login. Checked on chain.
- **Withdraw, raise a limit, or move its own NEAR.** Its key is a function-call
  key for `pocket_send` only, and it can't attach a deposit.
- **Pay a tweet twice.** The API records each tweet ID and pays it at most once
  ([`backend/api/src/near/pocket.ts`](backend/api/src/near/pocket.ts)).
- **Move anything without the API's say-so.** The bot reaches `POST /near/bot/send`
  with a shared secret, and the API checks the sender's linked X account.

You can withdraw everything in your pocket, or change its limit, from **Tweet to
pay** at any time. Those you sign yourself; the relayer pays the gas.

Run your own copy of the bot (it never posts unless you say so):

```bash
# In .env: X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET for the bot's
# X account, and SELKIE_BOT_SECRET (32+ characters, the same value the API has).
SELKIE_CHAIN=near SELKIE_API_URL=http://localhost:4100 SELKIE_WEB_URL=http://localhost:3000 npm run dev:bot
#    You see "Selkie bot on NEAR: ...". Replies are printed, not posted.
SELKIE_BOT_DRY_RUN=0 SELKIE_CHAIN=near ... npm run dev:bot   # posts for real
```

## Run it locally

You need Node 20.6+, Postgres, Rust (rustc 1.93+ with the `wasm32-unknown-unknown`
target), and a [Privy](https://dashboard.privy.io) app with **X** login and
embedded wallets turned on.

```bash
git clone https://github.com/SelkieLabs/Selkie && cd Selkie
npm install
cp .env.example .env                        # set PRIVY_APP_ID, PRIVY_APP_SECRET
cp frontend/.env.example frontend/.env.local   # set NEXT_PUBLIC_PRIVY_APP_ID
createdb selkie_near
echo 'NEAR_DATABASE_URL=postgres://localhost:5432/selkie_near' >> .env

# 1. Testnet accounts. The faucet funds the root; each child gets a fresh key
#    appended to .env (never printed). Pick a root name nobody has taken.
NEAR_ROOT_ACCOUNT=<yourname>.testnet npm run near:setup
#    You see "created x.<yourname>.testnet", "created escrow...", and a table of accounts.

# 2. Build both contracts, then deploy the escrow and the pocket.
npm run build:contracts:near
npm run near:deploy-escrow
npm run near:deploy-pocket                  # optional: only needed for Tweet to pay

# 3. The API in NEAR mode (runs its migrations on start).
SELKIE_CHAIN=near PORT=4100 npx tsx --env-file=.env backend/api/src/index.ts
curl localhost:4100/health                  # {"ok":true,"chain":"near","network":"testnet"}

# 4. The web app, in another terminal.
SELKIE_API_ORIGIN=http://localhost:4100 npm run dev:web
#    Open http://localhost:3000 and sign in with X.
```

Optional settings, all in `.env.example` with a line on what each does:
`NEAR_POCKET_*` (Tweet to pay), `ONECLICK_*` (other chains), `PAYCREST_*` (bank
cash-out), `X_BEARER_TOKEN` (payments that wait for an X user ID).

To run the whole money path on testnet without a browser, put 0.02 test USDC in
your root account (faucet.circle.com, NEAR Testnet), then run
`npm run test:live:near`. It holds money for an unclaimed handle, creates a handle
account with a brand-new key, proves Selkie holds none of its keys, claims into
it, and refunds a second hold. `npm run test:live:near:pocket` does the same for
the pocket: it checks the bot's key is refused for anything but `pocket_send`,
then tops up 1 USDC, pays 0.30 from it, fails a send over the limit, and
withdraws the rest.

## What's new at NEAR HACKATHON

Full diff of the hackathon work:
[compare/3525dc8...main](https://github.com/SelkieLabs/Selkie/compare/3525dc8...main).

1. **Selkie holds zero keys to user accounts.** Each user's key is their Privy
   embedded NEAR wallet, created in the browser. The backend creates the account
   with that public key as its only key and never sees the private key.
   [`NearChain.createHandleAccount`](packages/chain-near/src/chain.ts),
   [`identity-chain.ts`](backend/api/src/near/identity-chain.ts),
   [`prove-keys.ts`](packages/chain-near/scripts/prove-keys.ts), and the badge in
   [`KeyProof.tsx`](frontend/src/components/wallet/KeyProof.tsx).
2. **A handle becomes a human-readable account.** @amaka gets
   `amaka.x.selkiepay.testnet`. Only someone who proved that X login can get a
   name under `x.`, so the namespace can't be squatted. Name rules and collisions
   are in [`names.ts`](packages/chain-near/src/names.ts).
3. **Nobody pays gas.** The browser builds a NEP-366 delegate action and signs its
   hash with the user's Privy key. The relayer pays the fee and submits it.
   [`browser.ts`](packages/chain-near/src/browser.ts),
   [`delegate.ts`](packages/chain-near/src/delegate.ts),
   [`relayer.ts`](packages/chain-near/src/relayer.ts).
4. **Any chain in, any chain out, with NEAR Intents (1Click).** You can add USDC or
   USDT from 10 chains, or cash out to them. On testnet these show live
   `dry: true` prices, because 1Click runs on mainnet only.
   [`intents.ts`](packages/chain-near/src/intents.ts),
   [`backend/api/src/near/intents.ts`](backend/api/src/near/intents.ts),
   [`OtherChain.tsx`](frontend/src/components/wallet/OtherChain.tsx).
5. **Payments wait for an X user ID, not a username.** Usernames get renamed and
   re-registered. The escrow holds money for `sha256("x-id:" + id)` when the API
   can look the ID up (`X_BEARER_TOKEN`), and for `sha256("x:" + username)`
   otherwise. A claim checks both. A handle X would never allow (a NEAR account
   pasted into the handle box, say) is refused before anything is signed.
   [`handle.ts`](packages/core/src/domain/handle.ts),
   [`recipient.ts`](packages/chain-near/src/recipient.ts),
   [`x-lookup.ts`](backend/api/src/near/x-lookup.ts),
   [`x-handle.ts`](backend/api/src/near/x-handle.ts).

Also built on NEAR during the hackathon:

- **Tweet to pay: the X pocket.** A pocket contract holds a small amount each
  user parks with `ft_transfer_call` (`{"kind":"top_up"}`). The X bot's
  function-call key can call `pocket_send` and nothing else, and the contract
  holds it to the owner's daily limit and to Selkie handle accounts. Like the
  escrow, it takes the money out before sending and restores it in a callback if
  the transfer fails. The first real tweet it paid:
  [`HdzoKjfK…`](https://explorer.testnet.near.org/transactions/HdzoKjfKuVLnWfc8E8purQqeNkqquhJ4B86X6vg9k2Pe).
  [`contracts-near/pocket`](contracts-near/pocket/src/lib.rs),
  [`pocket.ts`](packages/chain-near/src/pocket.ts),
  [`backend/api/src/near/pocket.ts`](backend/api/src/near/pocket.ts),
  [`PocketPanel.tsx`](frontend/src/components/wallet/PocketPanel.tsx),
  [`respond.ts`](backend/bot/src/respond.ts).
- **Cash out to a bank.** Naira to any Nigerian bank, and shillings to banks and
  mobile money in Kenya, Uganda and Tanzania, through
  [Paycrest](https://paycrest.io). The app shows the account holder's name
  before you sign. The route is USDC on NEAR → NEAR Intents (EXACT_OUTPUT) → USDC on Base →
  a Paycrest order, and a signed webhook marks it paid. It moves money on mainnet
  only; testnet shows the rate as a preview.
  [`paycrest.ts`](backend/api/src/near/paycrest.ts),
  [`bank.ts`](backend/api/src/near/bank.ts),
  [`BankFields.tsx`](frontend/src/components/wallet/cashout/BankFields.tsx).
- **The escrow contract.** It holds `ft_transfer_call` deposits for a recipient
  key, both single (`hold`) and batch (`hold_many`). Only the oracle can release
  them, and the sender can take them back after expiry. It removes a payment
  before transferring it, and restores it in a callback if the transfer fails.
  It emits NEP-297 events. [`contracts-near/handle-escrow`](contracts-near/handle-escrow/src/lib.rs)
- **Pay many people with one signature.** One delegate action pays Selkie users
  directly, and holds one `hold_many` for everyone else.
- **DAO payouts.** `npm run near:dao` turns a CSV of `@handle,amount` lines into
  one Sputnik DAO proposal. When it runs, each handle's money waits for them.
  [`dao-payout.ts`](packages/chain-near/scripts/dao-payout.ts)
- **Notices when money arrives.** Web Push and email, plus feed lines for money
  sent from outside Selkie.
- **RPC failover.** `NEAR_RPC_URL` takes a list. A rate-limited or down endpoint
  is skipped, but a real answer like "account does not exist" is never retried.
  [`rpc.ts`](packages/chain-near/src/rpc.ts)

## Why NEAR

- **Named accounts.** A payment link can show `amaka.x.selkiepay.testnet` instead
  of a 64-character hex string.
- **Many keys per account, each one visible on chain.** Selkie adds exactly one
  key, the user's, and anyone can check that.
- **Function-call access keys.** The X bot and the oracle each hold a key that can
  call one method on one contract. That is what makes a bot that spends money
  safe to run.
- **NEP-366 meta-transactions.** Users sign and Selkie pays the fee, with no
  custody and no gas token for the user.
- **NEP-141 `ft_transfer_call`.** It lets the escrow and the pocket receive money
  and record whose it is in one atomic step.
- **NEAR Intents.** One API to bring money in from, and send it out to, the
  chains people already use, and the bridge to a bank payout.

## Relayer safety

`POST /near/relay` submits a signed delegate action only when all of these hold
([`relayer.ts`](packages/chain-near/src/relayer.ts)):

- The signer is the signed-in user's own account.
- The signed bytes match a prepare record made for this user minutes ago, with
  the same receiver, method, arguments and deposit. Each record works once.
- The receiver and method are on a short list: `ft_transfer`,
  `ft_transfer_call` and `storage_deposit` on USDC; `refund` on the escrow; and
  `pocket_withdraw` and `pocket_set_cap` on the pocket.
- A cash-out to another chain or a bank may only pay the deposit address of a
  1Click quote the server itself requested.
- The deposit is at most 1 yoctoNEAR, gas is capped, and each user is rate-limited.

## Trust model

| Who | Can | Cannot |
| --- | --- | --- |
| Relayer key | pay gas for actions the user signed | create or change what the user signed |
| Account creator (`x.`) | create a new handle account with the user's key | add a key to an existing account, move user money |
| Oracle key (function-call key, `claim` only) | release waiting money to the account of whoever proved that X login | take money, change amounts, block a refund |
| Escrow contract | hold money for a recipient key, refund the sender after expiry | release to anyone except through the oracle |
| X bot key (function-call key, `pocket_send` only) | pay Selkie handle accounts from a pocket, up to that pocket's daily limit | touch money outside pockets, withdraw, change a limit, pay any other address |
| Pocket contract | hold what each user parked, give it back to them whenever they ask | let anyone but the owner withdraw or change the limit |
| Privy | holds the user's key material (their custody model) | — Selkie turns on no server-side signers |

Limits, stated plainly:

- **The oracle is a trust point.** A stolen oracle key could send waiting money
  to the wrong account. It cannot touch money already in anyone's account.
- **The bot is a smaller one.** A stolen bot key could pay real Selkie users up to
  each pocket's daily limit, from pockets only. Keep pockets small; that's what
  they are for.
- **Users trust Privy for key custody.**
- **Testnet.** NEAR Intents and bank payouts show previews on testnet, because
  1Click runs on mainnet only. Bank payouts also need Paycrest to approve
  Selkie's business (KYB).
- **The bot runs as one process** on the builder's machine for now. If it is not
  running, a tweet gets no reply and nothing moves.

## Contracts and accounts (testnet)

| Account | Role |
| --- | --- |
| [escrow.selkiepay.testnet](https://explorer.testnet.near.org/accounts/escrow.selkiepay.testnet) | handle-escrow contract |
| [pocket.selkiepay.testnet](https://explorer.testnet.near.org/accounts/pocket.selkiepay.testnet) | pocket contract (Tweet to pay) |
| [pocketbot.selkiepay.testnet](https://explorer.testnet.near.org/accounts/pocketbot.selkiepay.testnet) | the X bot; its only key can call `pocket_send` and nothing else |
| [x.selkiepay.testnet](https://explorer.testnet.near.org/accounts/x.selkiepay.testnet) | parent of every handle account; only creates accounts |
| [relayer.selkiepay.testnet](https://explorer.testnet.near.org/accounts/relayer.selkiepay.testnet) | pays gas for users' delegate actions |
| [oracle-v2.selkiepay.testnet](https://explorer.testnet.near.org/accounts/oracle-v2.selkiepay.testnet) | releases waiting money; its only key can call `escrow.claim` and nothing else |
| [selkiepay.testnet](https://explorer.testnet.near.org/accounts/selkiepay.testnet) | root; used by setup scripts only |
| `3e2210e1…cb8af` | Circle's USDC on NEAR testnet (6 decimals) |
| [selkie-payouts.sputnikv2.testnet](https://explorer.testnet.near.org/accounts/selkie-payouts.sputnikv2.testnet) | test DAO for payouts |

## Mainnet

Testnet and mainnet differ only by configuration. What is ready:

- `npm run near:setup:mainnet` prints the plan and cost and changes nothing. With
  `--execute` and `SELKIE_MAINNET_OK=yes` it creates `x.`, `escrow.`, `relayer.` and
  `oracle.` under `selkiepay.near`. Keys go to `.env.mainnet`, kept apart from
  testnet's. USDC's contract is read from 1Click's token list, never typed in.
- `npm run near:deploy-escrow:mainnet` deploys the escrow there.
- On mainnet, **Add money** and **Another chain** move real money through 1Click,
  and **A bank account** pays out through Paycrest.

Not done yet: the mainnet root account, the deploys, and Paycrest's business
approval.

## Tests

| Command | Proves |
| --- | --- |
| `npm test` | 548 tests. These cover amounts, account names, recipient keys, building and verifying delegate actions, the relay policy, RPC failover, the 1Click and Paycrest clients, the pocket routes, and every bot reply (each one fits in a tweet). The NEAR API also runs end to end on a simulated chain with real ed25519 signatures. |
| `npm run test:contracts:near` | 35 escrow tests (hold and claim, hold_many, wrong token, bad msg refunded, non-oracle claim refused, double claim paid once, refund rules, a failed transfer restoring the payment) and 34 pocket tests (only the bot sends, daily limit per UTC day, only to handle accounts, only the owner withdraws or sets the limit, a failed transfer restoring the pocket) |
| `npm run test:live:near` | the escrow money path on real testnet (needs 0.02 test USDC) |
| `npm run test:live:near:pocket` | the pocket on real testnet: the bot key's limits, then top up, send, over-limit refusal, withdraw (needs 1 test USDC) |
| `npm run prove:keys -- <account>` | whether Selkie holds any key to an account, read from the chain |

## Libraries

- near-api-js 7.4.0
- near-sdk 5.29.1 (Rust)
- @privy-io/react-auth 3.36
- Next.js 16 and React 19
- Tailwind CSS
- lucide-react
- lenis 1.3.27 (smooth scrolling on the landing)
- qrcode
- Fastify 5 and @fastify/rate-limit
- pg
- web-push 3.6.7
- NEAR Intents 1Click API
- Paycrest API (bank payouts)
- X API v2 (the bot)
- Resend (email API)

## Disclosure

Selkie existed before the hackathon, as a Stellar app. The first commit,
[`3525dc8`](https://github.com/SelkieLabs/Selkie/commit/3525dc8), tagged
`pre-hackathon`, is that Stellar baseline: the web app, the Fastify API, the X
bot, the Soroban escrow and the Stellar adapter. Everything NEAR was built
during the hackathon and is in the diff above:

- `contracts-near/` (the escrow and the pocket)
- `packages/chain-near/`
- `backend/api/src/near/`
- the NEAR mode of the web app and of the X bot, including Tweet to pay
- bank cash-out through Paycrest
- push and email notices

The Stellar code is untouched and still runs with `SELKIE_CHAIN=stellar`. AI
coding tools (Claude Code) were used throughout.

---

# Selkie on Stellar (pre-hackathon baseline)

Everything below describes the Stellar build that existed before the hackathon.
It still works with `SELKIE_CHAIN=stellar` and `NEXT_PUBLIC_SELKIE_CHAIN=stellar`.

Send money to any social handle. No app, no seed phrase, and no gas for the person you pay. Selkie holds digital dollars (USDC), and turns them into local cash, airtime, data, bills, or a swap. Multi-chain by design, Stellar first.

- Product scope: [docs/selkie-stellar-product-scope.md](docs/selkie-stellar-product-scope.md)
- How the code is organized and why: [ARCHITECTURE.md](ARCHITECTURE.md)

## Layout

```
frontend/         the web app (Next.js + Tailwind)
backend/
  api/            the backend the surfaces call
  bot/            X + Telegram surfaces
packages/
  core/           chain-agnostic product logic + the chain interface
  chain-stellar/  the Stellar adapter (the only Stellar-specific code)
contracts/
  handle-escrow/  the Soroban contract that holds money for a handle
ops/              how the API is kept running on a dev machine
assets/brand/     logos
docs/             product scope + strategy
```

## Run it

Two processes: the API on `:4000` and the web app on `:3000`. The web app
rewrites `/api/*` to the API so the browser only ever talks to one origin, which
means there is no CORS layer to get wrong. Postgres sits behind the API and
holds everything that has to survive a restart.

```bash
npm install                       # links the workspaces together

cp .env.example .env              # fill it in, see below
cp frontend/.env.example frontend/.env.local

brew services start postgresql@17 # or however you run Postgres
createdb selkie
npm run db:migrate                # safe to re-run; it says when there is nothing to do

npm run dev:api                   # terminal 1 -> http://localhost:4000
npm run dev:web                   # terminal 2 -> http://localhost:3000
```

Open http://localhost:3000 and sign in. Both `.env` files are gitignored and
must never be committed.

### Keeping the API up on its own

`npm run dev:api` dies with the terminal that started it. On the development Mac
the API instead runs as a launch agent, so it survives a crash, a closed window
and a reboot.

```bash
cp ops/com.selkie.api.plist ~/Library/LaunchAgents/   # edit the paths inside first
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.selkie.api.plist
```

| To | Run |
| --- | --- |
| Check it | `launchctl print gui/$(id -u)/com.selkie.api \| grep -E "state\|pid"` |
| Read the log | `tail -f backend/api/api.log` |
| Pick up code changes | `launchctl kickstart -k gui/$(id -u)/com.selkie.api` |
| Stop it | `launchctl bootout gui/$(id -u)/com.selkie.api` |

It does not watch files, so a code change needs the kickstart above. Killing the
pid does nothing lasting: launchd starts it straight back up. If Postgres is
down when it boots it exits and retries until the database answers, so the order
the two come up in does not matter.

### The bots

Nothing starts the X or Telegram bot for you, and nothing keeps it running. It
is a foreground process you start when you want it.

```bash
npm run dev:bot
```

It reads the same root `.env` the API does, so one value of `SELKIE_BOT_SECRET`
serves both. It also needs all four `X_*` credentials before it will touch X at
all. **It is in dry run unless you turn that off**, which means it works out
every reply and posts none of them. Set `SELKIE_BOT_DRY_RUN=0` to let it answer
people for real.

Polling X spends metered API credits, so stop it when you are not using it.
Stop it with Ctrl-C, or by pid. Do not `pkill -f` it: the API runs the same
`src/index.ts` under the same runner and would go down with it.

### What each variable is for

`.env` at the repo root (read by the API):

| Variable | Required | What it does |
| --- | --- | --- |
| `PRIVY_APP_ID` | yes | Identifies the app to Privy. |
| `PRIVY_APP_SECRET` | yes | Authenticates Selkie to Privy so it can look a signed-in user up. Never goes near the browser. |
| `SELKIE_SPONSOR_SECRET` | yes | Pays every fee and account reserve, which is what makes Selkie gasless. Whoever holds it can spend that account. |
| `SELKIE_ORACLE_SECRET` | yes | Attests logins to the escrow contract. Its only power is releasing money to the handle that proved it owns it, and it must be the key the deployed contract was told to trust. |
| `DATABASE_URL` | yes | Postgres. Accounts, handles, activity, requests and the sealed account keys. |
| `SELKIE_WALLET_KEY` | yes | Seals account keys before they are stored, so a database dump is not a set of spendable wallets. `version:base64`, newest first, comma separated. |
| `SELKIE_BOT_SECRET` | no | Lets the bots act for whoever messaged them. Unset, that path is not installed at all. Required if you run a bot. |
| `SELKIE_NETWORK` | no | `testnet` (default) or `public`. |
| `SELKIE_HANDLE_ESCROW_ID` | no | Overrides the contract id recorded in `contracts/deployments/<network>.env`. |
| `PORT` | no | Defaults to `4000`, which is what the web app expects. |
| `DATABASE_URL_TEST` | no | A throwaway database for the tests. Without it the storage tests skip rather than fail. |

The bot reads its own set, and `SELKIE_BOT_SECRET` has to match the API's:

| Variable | Required | What it does |
| --- | --- | --- |
| `SELKIE_BOT_SECRET` | yes | Same value as the API's. A bot that cannot prove who it acts for does not start. |
| `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` | for X | All four or none. Three of four fails at boot with a clear message rather than later with a 401. |
| `SELKIE_BOT_DRY_RUN` | no | On unless set to `0`. Works out every reply and posts none of them. |
| `SELKIE_API_URL` | no | Defaults to `http://127.0.0.1:4000`. |
| `X_HANDLE` | no | Defaults to `SelkiePay`. |

`frontend/.env.local` (read by the web app):

| Variable | Required | What it does |
| --- | --- | --- |
| `NEXT_PUBLIC_PRIVY_APP_ID` | yes | The same app id. Public by design: it ships in the browser bundle. |
| `SELKIE_API_ORIGIN` | no | Where `/api/*` is rewritten to. Defaults to `http://localhost:4000`. |
| `NEXT_PUBLIC_SELKIE_NETWORK` | no | Which network the explorer links point at. `testnet` unless set to `public`, and it has to agree with the API's `SELKIE_NETWORK`. |

Config is read once at boot, so a missing value fails loudly on start rather
than quietly at the moment someone tries to send money.

### Before the first sign-in works

- The Privy dashboard needs **Google** and **X** enabled as login methods, and
  whatever domain you serve from added to the allowed list. `localhost` is
  allowed by default.
- The sponsor account needs XLM. On testnet:
  `https://friendbot.stellar.org?addr=<sponsor public address>`.
- To actually move dollars on testnet, get test USDC from
  [faucet.circle.com](https://faucet.circle.com) and send it to the address the
  app shows under **Deposit**. That screen provisions the wallet before it
  hands the address over, so it can receive the moment you copy it.

### Everything else

```bash
npm test            # the whole suite (node:test)
npm run typecheck   # every workspace
npm run build:web   # production build of the web app
npm run db:migrate  # bring the database up to date
npm run prove:restart    # proves state actually survives a restart
npm run test:live   # exercises the adapter against real testnet
npm run test:contracts   # cargo test for the Soroban contract
```

The storage tests need a real database. Point `DATABASE_URL_TEST` at a
throwaway one (`createdb selkie_test`) and they run; leave it unset and they
skip rather than fail, so a fresh clone still gets a green suite.

## Status

Live on Stellar testnet, and only there. The escrow contract, the Stellar
adapter, the API and the web app work end to end: sign in with Google or X, fund
a wallet, pay a handle that has never heard of Selkie, and watch it land the
moment that person signs in. State is in Postgres and account keys are sealed
before they are written.

The X bot works and is in dry run. Cash out is screens only: the flow is real
and the last button says so, because no provider is wired up yet. Telegram is
deferred. Nothing is deployed; the app at selkiepay.vercel.app is still the
older Canton build, which stays in its own repo as the proof-of-execution
version.
