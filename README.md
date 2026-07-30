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
assets/brand/     logos
docs/             product scope + strategy
```

## Develop

```
npm install        # links the workspaces together
npm run dev:web    # run the web app on http://localhost:3000
npm run build:web
```

The app rewrites `/api` and `/auth` to the Selkie server so the browser stays on one
origin; point it somewhere other than `http://localhost:4000` with `SELKIE_API_ORIGIN`.
See [frontend/README.md](frontend/README.md).

## Status

Foundation scaffolded: the monorepo, the chain-abstraction layer, and the design system are in place. The Stellar adapter and the X/Telegram/api surfaces are being built on top of this structure. The Canton build stays in its own repo as the proof-of-execution version.
