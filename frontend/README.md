# frontend

The Selkie web app: Next.js (App Router) + TypeScript + Tailwind.

```
src/
  app/            routes. One folder per URL, each with a page.tsx.
    layout.tsx    the shell: fonts, metadata, providers, the scene
    globals.css   design system + the moonlit-cove styles
  components/     the pieces screens are built from
  contexts/       auth + toasts
  lib/            the typed API client and formatting helpers
  assets/         bundled token logos
public/           files served as-is (favicon, mark)
```

## Routes

| URL                | File                                  |
| ------------------ | ------------------------------------- |
| `/`                | `app/page.tsx`                        |
| `/docs`            | `app/docs/page.tsx`                   |
| `/pitch`           | `app/pitch/page.tsx`                  |
| `/dashboard`       | `app/dashboard/page.tsx` (→ activity) |
| `/dashboard/:tab`  | `app/dashboard/[tab]/page.tsx`        |
| `/account/:handle` | `app/account/[handle]/page.tsx`       |
| `/tx/:id`          | `app/tx/[id]/page.tsx`                |
| anything else      | `app/not-found.tsx` (→ `/`)           |

## Develop

```
npm run dev        # http://localhost:3000
npm run build
npm start
npm run typecheck
npm run lint
```

## Talking to the API

`/api/*` and `/auth/*` are rewritten to the Selkie server by `next.config.ts`, so
the browser stays on one origin and the session cookie rides the X login redirect.
Set the target with `SELKIE_API_ORIGIN` (defaults to `http://localhost:4000`); in
production point it at the deployed backend, e.g.

```
SELKIE_API_ORIGIN=https://selkie-api-production.up.railway.app
```
