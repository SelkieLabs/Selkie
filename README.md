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
assets/brand/     logos
docs/             product scope + strategy
```

## Run it

Two processes: the API on `:4000` and the web app on `:3000`. The web app
rewrites `/api/*` to the API so the browser only ever talks to one origin, which
means there is no CORS layer to get wrong.

```bash
npm install                       # links the workspaces together

cp .env.example .env              # fill it in, see below
cp frontend/.env.example frontend/.env.local

npm run dev:api                   # terminal 1 -> http://localhost:4000
npm run dev:web                   # terminal 2 -> http://localhost:3000
```

Open http://localhost:3000 and sign in. Both `.env` files are gitignored and
must never be committed.

### What each variable is for

`.env` at the repo root (read by the API):

| Variable | Required | What it does |
| --- | --- | --- |
| `PRIVY_APP_ID` | yes | Identifies the app to Privy. |
| `PRIVY_APP_SECRET` | yes | Authenticates Selkie to Privy so it can look a signed-in user up. Never goes near the browser. |
| `SELKIE_SPONSOR_SECRET` | yes | Pays every fee and account reserve, which is what makes Selkie gasless. Whoever holds it can spend that account. |
| `SELKIE_ORACLE_SECRET` | yes | Attests logins to the escrow contract. Its only power is releasing money to the handle that proved it owns it, and it must be the key the deployed contract was told to trust. |
| `SELKIE_NETWORK` | no | `testnet` (default) or `public`. |
| `SELKIE_HANDLE_ESCROW_ID` | no | Overrides the contract id recorded in `contracts/deployments/<network>.env`. |
| `PORT` | no | Defaults to `4000`, which is what the web app expects. |

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
npm run test:live   # exercises the adapter against real testnet
npm run test:contracts   # cargo test for the Soroban contract
```

## Status

Live on Stellar testnet. The escrow contract, the Stellar adapter, the API and
the web app are built and working end to end: sign in with Google or X, fund a
wallet, pay a handle that has never heard of Selkie, and watch it land the
moment that person signs in. The X and Telegram bots are next. The Canton build
stays in its own repo as the proof-of-execution version.
