# Selkie

Send money to any social handle. No app, no seed phrase, and no gas for the person you pay. Selkie holds digital dollars (USDC), and turns them into local cash, airtime, data, bills, or a swap. Multi-chain by design, Stellar first.

- Product scope: [docs/selkie-stellar-product-scope.md](docs/selkie-stellar-product-scope.md)
- How the code is organized and why: [ARCHITECTURE.md](ARCHITECTURE.md)

## Layout

```
apps/
  web/            the web app (React + Vite)
  bot/            X + Telegram surfaces
  api/            backend the surfaces call
packages/
  core/           chain-agnostic product logic + the chain interface
  chain-stellar/  the Stellar adapter (the only Stellar-specific code)
  ui/             reusable components + design system, shared by every surface
assets/brand/     logos
docs/             product scope + strategy
```

## Develop

```
npm install        # links the workspaces together
npm run dev:web    # run the web app
```

## Status

Foundation scaffolded: the monorepo, the chain-abstraction layer, and the design system are in place. The Stellar adapter and the X/Telegram/api surfaces are being built on top of this structure. The Canton build stays in its own repo as the proof-of-execution version.
