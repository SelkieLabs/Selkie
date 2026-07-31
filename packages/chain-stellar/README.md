# @selkie/chain-stellar

The Stellar adapter. This is the only package in Selkie that imports a Stellar
SDK; everything else talks to the `ChainAdapter` interface in `@selkie/core`.

## What each file is for

| File | Responsibility |
| --- | --- |
| `adapter.ts` | `StellarAdapter`, the `ChainAdapter` implementation. Decides direct payment vs escrow. |
| `amounts.ts` | Decimal strings to stroops and back. Money never touches a float. |
| `assets.ts` | The allowlist of assets Selkie will show and move. |
| `config.ts` | Network settings. Testnet and mainnet differ only by config. |
| `network.ts` | Horizon and Soroban RPC plumbing, and fee bumping (this is what "no gas" means). |
| `provisioning.ts` | Creating accounts and trustlines with sponsored reserves. |
| `escrow.ts` | Client for the handle-escrow contract. |
| `swap.ts` | Converting assets over Stellar's built-in order book. |
| `directory.ts` | Which handle owns which address. An interface, because the backend owns that table. |
| `bootstrap.ts` | One-time per-network setup so an asset can be used by contracts. |
| `signer.ts` | How things get signed, without this package knowing where keys live. |

## The two send paths

```
send(from, to, amount)
        │
        ├── recipient has an account ──▶ direct payment, fee-bumped by the sponsor
        │
        └── recipient has never joined ─▶ handle-escrow deposit, addressed to
                                          sha256("x:<username>"), claimable when
                                          they sign in
```

Callers never choose. The result says which happened via `heldForClaim`.

## Why users need no XLM

A Stellar account costs a base reserve, and each trustline costs more. Asking
someone to buy a crypto token before they can receive a dollar is the exact wall
Selkie exists to remove, so:

- accounts and trustlines are created with **sponsored reserves**, paid by the sponsor account
- every user transaction, classic or contract, is wrapped in a **fee bump** paid by the sponsor

The network still charges. Selkie pays it. Users hold only dollars.

## Swap

Stellar has an order book and liquidity pools in the protocol itself, so a swap
is a path payment to yourself: send USDC, receive XLM, network finds the route.
No DEX contract to deploy or trust. Quotes come from the network, and execution
carries a slippage floor so a route moving between quote and submit cannot
silently cost the user.

Call it **Convert** in the UI. "Swap" and "exchange" mean different things to
different people, and a money app should not make anyone guess.

## Extension points

Each of these is an interface so it can be replaced without touching payment logic:

- **`Signer` / `SignerProvider`** - today keys are held by the backend. Moving to
  Privy embedded wallets or device passkeys should be a new `Signer` and nothing else.
- **`AccountDirectory`** - in-memory now, Postgres in the API server.
- **`AssetRegistry`** - add an asset by adding a definition.

## Proven live

`npm run test:live` runs the whole product flow against real testnet, no mocks:
a sponsored wallet with zero XLM, a payment to a handle that has never used
Selkie, that handle claiming it by "signing in", a second payment settling
directly, and a conversion to XLM on the order book.

```
SPONSOR_SECRET=... ORACLE_SECRET=... npm run test:live
```

Unit tests for the pure logic (`npm test`) cover the money math and the asset
allowlist, including precision the format cannot represent and lookalike assets
from an impostor issuer.
