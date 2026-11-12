# @selkie/chain-near

The NEAR side of Selkie. This is the only package that imports a NEAR SDK
(`near-api-js` 7.4.0, pinned). The API and the bot import it; the web app
imports only `@selkie/chain-near/browser`, which holds no keys and runs no
server code.

## What each file is for

| File | Responsibility |
| --- | --- |
| `config.ts` | Network settings from env. Testnet and mainnet differ only by config. Two types: one safe to send to a browser, one with the server's keys. |
| `amounts.ts` | Decimal strings to base units and back (USDC has 6 decimals). Money never touches a float. |
| `names.ts` | X handle to account name: `@Amaka_` gets `amaka.x.selkiepay.testnet`. Handles taken names and NEAR's account-id rules. |
| `recipient.ts` | The 32-byte key held money waits for: the X user id when it can be looked up, else the username. |
| `keys.ts` | Who can sign for an account. The proof badge and `prove:keys` both read it. |
| `escrow.ts` | The handle-escrow contract: hold, hold_many and refund calls, views, and parsing its events. |
| `delegate.ts` | NEP-366 delegate actions. The browser and the relayer rebuild the same bytes from the same prepared JSON. |
| `browser.ts` | `@selkie/chain-near/browser`: signs a prepared delegate with a function the web app passes in (Privy's `signRawHash`). It has no Privy import. |
| `relayer.ts` | What the relayer will pay for: which contracts and methods, deposit, gas, and an exact match with what was prepared. |
| `chain.ts` | `NearChain`, everything the backend does on NEAR. Creates accounts, relays, claims as the oracle, reads balances. Each key has its own job. |
| `intents.ts` | NEAR Intents (1Click API): token list, quotes, status, deposit notice. |
| `dao.ts` | A Sputnik DAO proposal that pays a list of X handles through the escrow. |

The contract itself lives in its own Cargo workspace:
[`contracts-near/handle-escrow`](../../contracts-near/handle-escrow).

## Prepare, sign, relay

The user's key is the Privy embedded NEAR wallet, so the backend never has it.
It decides what the user is asked to sign. The browser signs that. The backend
then checks the signature is over exactly that before paying the gas.

```
browser                         API                               NEAR
   │  POST /near/payments/prepare  │                                  │
   │ ─────────────────────────────▶│ builds the actions, reads nonce  │
   │◀───────────────────────────── │ + block height, stores a prepare │
   │  PreparedDelegate (JSON)      │                                  │
   │                               │                                  │
   │ build DelegateAction, hash it │                                  │
   │ (NEP-461 prefix), Privy signs │                                  │
   │                               │                                  │
   │  POST /near/relay             │                                  │
   │ ─────────────────────────────▶│ rebuild from the stored prepare, │
   │                               │ bytes must match, policy check   │
   │                               │ ────────────────────────────────▶│ relayer pays gas,
   │                               │                                  │ user's account acts
```

The relayer checks two things, and reading what the user meant is neither:

1. **Policy.** It only calls the USDC contract (`ft_transfer`,
   `ft_transfer_call`, `storage_deposit`) or the escrow (`refund`), with at most
   1 yoctoNEAR attached and gas capped.
2. **Exactness.** The signed bytes must equal the bytes Selkie prepared, signed
   by the key the prepare named, and each prepare works once. So the receiver
   and the amount are whatever the server wrote at prepare time. For a cash-out
   to another chain, the receiver is the deposit address from a 1Click quote
   the server made then, never an address the browser sent.

## The two send paths

```
send(@amaka, 2.00)
        │
        ├── @amaka has a Selkie account ─▶ USDC ft_transfer to amaka.x.selkiepay.testnet
        │
        └── @amaka has never signed in ──▶ USDC ft_transfer_call to the escrow,
                                           msg {"kind":"hold","recipient":<32-byte key>, ...}
                                           waits until @amaka signs in with X
```

When @amaka signs in, `NearChain.createHandleAccount` creates
`amaka.x.selkiepay.testnet` with their Privy key as its **only** key. The oracle
then claims everything waiting for both of their recipient keys into it.

## Three keys, three narrow jobs

| Key | Can | Cannot |
| --- | --- | --- |
| Account creator (`x.selkiepay.testnet`) | create a handle account whose only key is the user's | add a key to an account that exists, move money |
| Relayer | pay gas for what a user signed | change what they signed |
| Oracle | call `escrow.claim`, and nothing else (function-call key) | take money, change amounts, block a refund |

None of them can touch money that is already in a user's account. Each is its
own `Account` object inside `NearChain`, so a bug in one path cannot borrow
another's authority.

## Scripts

Run from the repo root.

| Command | What it does |
| --- | --- |
| `npm run near:setup` | Creates the testnet accounts above once (safe to re-run). Keys go to `.env` and are never printed. |
| `npm run build:contracts:near` | Builds the escrow WASM. |
| `npm run near:deploy-escrow` | Deploys and initialises the escrow on testnet. |
| `npm run prove:keys -- <account>` | Lists an account's keys and says whether any of them is Selkie's. Needs no secrets. |
| `npm run test:live:near` | The whole money path on testnet: hold, create account, prove keys, claim, refund. Spends 0.02 test USDC. |
| `npm run near:dao -- …` | Creates a test DAO, proposes a payout from a CSV of `@handle,amount`, approves it. |
| `npm run near:rotate-oracle -- <prefix>` | Moves the escrow to a new oracle account. |
| `npm run near:lock-escrow` | Deletes every key on the escrow so its code can never change. Dry run unless `-- --yes`. |

## Tests

`npm test` at the root runs this package's unit tests with everything else:
the money math, account naming, recipient keys, the relay policy, the DAO
proposal, the 1Click client, and delegate actions signed and checked with real
ed25519 keys. `backend/api/src/near/app.test.ts` runs the real NEAR API on a
simulated chain, so the routes are tested end to end with no network.
