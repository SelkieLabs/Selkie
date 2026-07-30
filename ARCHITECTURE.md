# Architecture

Selkie is one product that can run on many chains and grow many features without rewrites. Three rules make that possible:

1. **Chain-specific code lives in exactly one place:** a chain adapter.
2. **Everything else is chain-agnostic** and talks to an interface, never to a chain SDK.
3. **Features are modules,** not edits scattered across the app.

## The layers

```
apps/            what users touch. Kept thin.
  web/           React app (browser)
  bot/           X + Telegram surfaces
  api/           backend the surfaces call
packages/
  core/          the brain. Chain-agnostic. No Stellar or Canton code here.
    chains/      the ChainAdapter interface + a registry of adapters
    services/    provider interfaces: ramp (cash in/out), airtime/bills, swap
    domain/      handles, payments, history (pure product logic)
  chain-stellar/ the Stellar implementation of ChainAdapter (the only Stellar code)
  ui/            reusable components + design system, shared by every surface
```

Dependencies only point one way: `apps -> core`. Adapters implement core's interface. UI knows nothing about chains.

## How to add a chain (say Base or Solana)

1. Create `packages/chain-<name>`.
2. Implement `ChainAdapter` from `packages/core/src/chains/adapter.ts`.
3. Register it once at startup: `registry.register(new BaseAdapter(config))`.

That is the whole change. No app, UI, or feature code moves. The app asks the registry for a chain and calls the same methods, so a new chain is additive, never a rewrite.

## How to add a feature (say savings or payment requests)

1. If it needs an outside provider (a biller, a yield protocol, a swap venue), add a small interface in `packages/core/src/services` and one implementation.
2. Put the product logic in `packages/core/src/domain`.
3. Add the UI in `packages/ui` and show it in `apps/web` (and the bot if it fits there).

Features go through core, never straight into chain code, so one feature lands in one place.

## Why money and handles live in core, not in the chain

A dollar is a dollar and a handle is a handle on every chain. Only *how* you move them differs. So `Money`, `HandleRef`, `Account`, and the payment flow live in `core`. Each adapter just knows how to make those real on its chain. That is what lets the same product ship on Stellar today and somewhere else tomorrow.
