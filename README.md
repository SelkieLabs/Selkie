# Selkie

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
