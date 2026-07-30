# backend/api

The backend the surfaces call. It owns sessions, social sign-in, deposit/sweep bookkeeping, and history, and it runs payments through `@selkie/core` against a registered `ChainAdapter`.

Being ported from the Canton build's `server/`, dropping the Canton-specific pieces and pointing the payment path at `@selkie/chain-stellar`.

Rule: this app talks to `core`, never to a chain SDK directly.
