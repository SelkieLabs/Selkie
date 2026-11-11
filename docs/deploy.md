# Deploying Selkie

Three things ship, in this order: the contract, the API, the web app. Each one
needs the one before it, and nothing here needs a tunnel or a local machine left
running.

```
Vercel                    Railway                   Stellar
┌──────────────┐          ┌──────────────┐          ┌──────────────────┐
│ frontend/    │  /api/*  │ backend/api  │  RPC     │ handle-escrow    │
│ Next.js      │ ───────▶ │ Fastify      │ ───────▶ │ contract         │
└──────────────┘  rewrite └──────────────┘          └──────────────────┘
```

The rewrite is the important part: the browser only ever talks to the Vercel
origin, so there is no CORS layer to get wrong.

## Before you start

- A [Privy](https://dashboard.privy.io) app, with **Google**, **X** and
  **Telegram** enabled as login methods and your deployed domain on the allowed
  list.
- The [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools/cli/stellar-cli)
  for the contract, and Rust with the `wasm32v1-none` target.
- A Railway account and a Vercel account.

## 1. The contract

Only needed once per network, and only if you are not using the one already
deployed.

```bash
stellar keys generate selkie-admin  --network testnet --fund
stellar keys generate selkie-oracle --network testnet --fund

cd contracts && ./scripts/deploy.sh          # NETWORK=public for mainnet
```

The script writes `contracts/deployments/<network>.env`, which is what the API
reads at boot. It is committed on purpose: a contract id is not a secret, and
one recorded copy beats four hardcoded ones.

The testnet deployment already in the repo:

| | |
| --- | --- |
| Contract | `CBQ54MQWSN32HX26QG2IJ2OFD2IKJBAPAHTDTV43TDUOSQWMO4V2CX5Y` |
| Network | testnet |

**The oracle key is the crown jewel.** Its only power is releasing an escrowed
payment to someone who proved they own the handle, but that is enough: whoever
holds it can route waiting money anywhere. It is rotatable with `set_oracle`,
which is the recovery path if it ever leaks.

## 2. The API on Railway

New Project → Deploy from GitHub repo. Then set:

| Setting | Value |
| --- | --- |
| Root directory | repository root |
| Build command | `npm ci` |
| Start command | `npm --workspace backend/api run start` |
| Health check path | `/health` |

Railway provides `PORT`; the API reads it.

### Variables

Everything in the root [`.env.example`](../.env.example), which is the API's env
and nothing else's:

| Variable | Notes |
| --- | --- |
| `PRIVY_APP_ID` | From the Privy dashboard. |
| `PRIVY_APP_SECRET` | Authenticates Selkie to Privy. **Never goes near the browser.** |
| `SELKIE_SPONSOR_SECRET` | Pays every fee and reserve. Whoever holds it can spend that account. |
| `SELKIE_ORACLE_SECRET` | Must match the oracle the contract was deployed with. |
| `SELKIE_NETWORK` | `testnet` or `public`. |
| `SELKIE_HANDLE_ESCROW_ID` | Only to override `contracts/deployments/<network>.env`. |

Config is read once at boot, so a missing value fails on start rather than in
the middle of somebody's payment.

### Keep the sponsor funded

Every sign-up spends the sponsor's XLM on reserves. When it runs dry, account
creation breaks for everyone at once, and the failure looks like an unrelated
bug. On testnet: `https://friendbot.stellar.org?addr=<sponsor address>`. On
mainnet, alert on the balance.

## 3. The web app on Vercel

Add New Project → import the repo → set **Root Directory** to `frontend`. Vercel
reads [`frontend/vercel.json`](../frontend/vercel.json) and detects Next.js.

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_PRIVY_APP_ID` | The app id. Public by design: it ships in the bundle. |
| `SELKIE_API_ORIGIN` | The Railway URL, e.g. `https://selkie-api-production.up.railway.app` |

`SELKIE_API_ORIGIN` is read at build time by `next.config.ts`, so **changing it
needs a redeploy**, not just a restart.

Finally, add the Vercel domain to Privy's allowed origins. Until you do, logins
fail with a CORS error from Privy's own API, which looks like a bug in Selkie and
is not.

## Verifying a deployment

```bash
curl https://<api-domain>/health          # {"ok":true}
curl https://<web-domain>/api/health      # same, through the rewrite
```

The second one is the one that matters: it proves the rewrite is wired, which is
the piece that silently breaks and takes sign-in with it.

Then, in a browser: sign in, open **Add money**, and confirm an address comes
back. That exercises Privy, the API, the sponsor account and the ledger in one
tap.

## Security checklist

- [ ] `PRIVY_APP_SECRET`, `SELKIE_SPONSOR_SECRET` and `SELKIE_ORACLE_SECRET` exist
      only in the host's secret store. Never in the repo, never in `frontend/`.
- [ ] `frontend/.env.local` contains **only** `NEXT_PUBLIC_PRIVY_APP_ID`. Anything
      else in there is a secret sitting in the deployable directory.
- [ ] The mainnet oracle and sponsor keys are freshly generated, never the
      testnet ones.
- [ ] Privy's allowed origins list the deployed domain and nothing stale.
- [ ] `SELKIE_NETWORK=public` only when you mean it.
