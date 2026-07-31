# Architecture

Selkie is one product that can run on many chains and grow many features without rewrites. Three rules make that possible:

1. **Chain-specific code lives in exactly one place:** a chain adapter.
2. **Everything else is chain-agnostic** and talks to an interface, never to a chain SDK.
3. **Features are modules,** not edits scattered across the app.

## The layers

```
frontend/        the UI. What users see. Kept thin. Next.js + Tailwind.
  src/app/       routes, one folder per URL, plus the design system in globals.css
  src/components/  the pieces screens are built from
backend/         the services that run for them.
  api/           the backend the surfaces call
  bot/           X + Telegram surfaces
packages/        shared libraries. No UI, no server. Reused by frontend and backend.
  core/          the brain. Chain-agnostic. No Stellar or Canton code here.
    chains/      the ChainAdapter interface + a registry of adapters
    services/    provider interfaces: ramp (cash in/out), airtime/bills, swap
    domain/      handles, payments, history (pure product logic)
  chain-stellar/ the Stellar implementation of ChainAdapter (the only Stellar code)
contracts/       on-chain code (Rust, Soroban). Deployed, not imported.
  handle-escrow/ holds money addressed to a handle until its owner logs in
```

`contracts/` is its own section because it is a different artifact: it compiles to
WASM and lives on the ledger, so the app talks to it by contract id (read from
`contracts/deployments/<network>.env`) rather than importing it. The Stellar
adapter is the only thing that knows that id exists.

Dependencies only point one way: `frontend` and `backend` both depend on `packages/core`. Adapters implement core's interface. UI knows nothing about chains.

`frontend` is one package, not two. A separate component library earns its keep once a second surface renders HTML; until then the only thing it buys is an import hop. When the bot grows web views, extract the shared pieces then.

## How to add a chain (say Base or Solana)

1. Create `packages/chain-<name>`.
2. Implement `ChainAdapter` from `packages/core/src/chains/adapter.ts`.
3. Register it once at startup: `registry.register(new BaseAdapter(config))`.

That is the whole change. No app, UI, or feature code moves. The app asks the registry for a chain and calls the same methods, so a new chain is additive, never a rewrite.

## How to add a feature (say savings or payment requests)

1. If it needs an outside provider (a biller, a yield protocol, a swap venue), add a small interface in `packages/core/src/services` and one implementation.
2. Put the product logic in `packages/core/src/domain`.
3. Add the UI in `frontend`: a component in `src/components`, a route in `src/app` (and the bot if it fits there).

Features go through core, never straight into chain code, so one feature lands in one place.

## Why money and handles live in core, not in the chain

A dollar is a dollar and a handle is a handle on every chain. Only *how* you move them differs. So `Money`, `HandleRef`, `Account`, and the payment flow live in `core`. Each adapter just knows how to make those real on its chain. That is what lets the same product ship on Stellar today and somewhere else tomorrow.
