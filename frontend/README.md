# frontend

The Selkie web app: Next.js (App Router) + TypeScript + Tailwind.

```
src/
  app/            routes. One folder per URL, each with a page.tsx.
    layout.tsx    the shell: fonts, metadata, the scene
    providers.tsx Privy, auth and toasts
    globals.css   design system + the moonlit-cove styles
  components/     the pieces screens are built from
    wallet/       the flows: send, convert, activity, the prompts
  contexts/       auth + toasts
  lib/            the typed API client, formatting, display helpers
public/           files served as-is (favicon, mark)
```

## Routes

| URL           | File                        |
| ------------- | --------------------------- |
| `/`           | `app/page.tsx`              |
| `/wallet`     | `app/wallet/page.tsx`       |
| anything else | `app/not-found.tsx` (→ `/`) |

There are two screens and no more. Everything that interrupts the wallet is a
sheet on top of it, because a payment app that makes people navigate to find
their own money has already lost.

## The rules this UI is held to

- **No crypto words.** No trustline, gas, escrow, on-chain, wallet address. A
  payment to someone who has not joined reads "waiting for @amaka to claim".
- **Send is two steps.** Who and how much, then a confirm screen showing the
  face, the name and the handle. A mistyped handle is the top way people lose
  money in an app like this, and this is the only defence that works.
- **Balance is in dollars.** Other assets get a quiet second line.
- **Nothing is silent.** A login we have never seen asks before it becomes a
  wallet; a second wallet asks before it is merged in.
- Skeletons over spinners, teaching empty states, one dialog component.

## Signing in

Privy runs the Google and X logins and hands back an access token. Selkie issues
no session of its own: `lib/api.ts` sends that token as a bearer token and the
server verifies it. `AuthProvider` owns the four states that follow:
`loading`, `signed-out`, `needs-account`, `ready`.

Linking is not a settings page. Attaching an X account proves the handle belongs
to that person, which is exactly the proof the escrow contract needs, so the
moment it links, anything waiting for that handle lands in their wallet. That is
what `ClaimCelebration` is for.

## Develop

```
npm run dev        # http://localhost:3000
npm run build
npm start
npm run typecheck
npm run lint
```

`NEXT_PUBLIC_PRIVY_APP_ID` goes in `.env.local`, which is gitignored.

Before this app can log anyone in, the Privy dashboard needs Google and X
enabled as login methods, and the deployed domain added to the allowed list.

## Talking to the API

`/api/*` is rewritten to the Selkie server by `next.config.ts`, so every request
is same-origin and there is no CORS layer to get wrong. Set the target with
`SELKIE_API_ORIGIN` (defaults to `http://localhost:4000`); in production point it
at the deployed backend, e.g.

```
SELKIE_API_ORIGIN=https://selkie-api-production.up.railway.app
```
