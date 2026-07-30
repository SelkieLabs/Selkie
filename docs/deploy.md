# Deploying Selkie

## Live deployment

Selkie is deployed on Canton DevNet:

- **Front door (Vercel):** <https://selkiepay.vercel.app>
- **Backend (Railway):** <https://selkie-api-production.up.railway.app>

Vercel serves the web app and proxies `/api` and `/auth` to the Railway backend, so
the browser stays on one origin. Dev login is disabled and cookies are Secure. The
one remaining step to switch on Sign in with X is setting `X_CLIENT_ID` /
`X_CLIENT_SECRET` on Railway from an X developer app whose callback is
`https://selkiepay.vercel.app/auth/x/callback` (see Part A step 4). Until then the
site is fully browsable and the login button shows a graceful "unavailable" notice.

## Architecture

Selkie ships as one small Node server that hosts the API, the Sign in with X flow,
and the built web app, all on one origin. That single-origin shape is deliberate:
the session cookie is `SameSite=Lax`, which rides the X login redirect cleanly when
the app and API share a domain, and silently breaks if they are split across two.

So the reliable production shape is:

- **Railway** runs the Node server. It serves the web app and the API together, on
  one HTTPS domain. This is the demo URL, and X login works here.
- **Vercel** (optional) fronts the same app on its edge, by proxying `/api` and
  `/auth` back to Railway so the browser still sees one origin.

The Canton participant and Keycloak are reached over public HTTPS, so a cloud host
can talk to the ledger with no tunnelling.

## Before you start

- A Railway account: <https://railway.app>
- An X (Twitter) developer app with OAuth 2.0 enabled, for the client id and secret.
- Your working `server/.env` values. `server/.env.example` lists every key with notes.

## Part A. Backend + web app on Railway (the demo)

### 1. Create the project

Easiest path, no CLI:

1. Railway dashboard, **New Project**, **Deploy from GitHub repo**, pick
   `martinvibes/Selkie`.
2. Railway reads `railway.json` at the repo root. It builds the web app
   (`npm --prefix web-vite ci && npm --prefix web-vite run build`) and starts the
   server (`node server/src/index.mjs`).

CLI alternative (run these yourself, they need your login):

```bash
railway login          # opens the browser to authenticate as you
railway init           # create and link a project
railway up             # build and deploy the current directory
```

### 2. Set the variables

In the service's **Variables** tab, open the **Raw Editor** and paste your
`server/.env`, then adjust for production:

- `SELKIE_SECURE_COOKIES=1` (the domain is HTTPS)
- `SELKIE_SESSION_SECRET=<a long random hex string>` so logins survive restarts
- `SELKIE_DEV_LOGIN` must be **absent or 0**. Never enable dev login in public.
- `X_CLIENT_ID`, `X_CLIENT_SECRET` from your X app
- `X_REDIRECT_URI=https://<your-railway-domain>/auth/x/callback`
- Keep `SELKIE_PKG_ID`, `SELKIE_OPERATOR`, `SELKIE_PARTY_POOL=1`, the
  `SELKIE_JSON_API` / `SELKIE_AUTH_*` ledger keys, and the `SELKIE_CBTC_*` /
  `SELKIE_CETH_*` deposit keys as in your working `.env`.

You do not need to set `PORT` (Railway provides it) or `SELKIE_WEB_ROOT` (it
defaults to `web-vite/dist`).

### 3. Give it a domain

In **Settings**, **Networking**, **Generate Domain**. Copy the URL, for example
`https://selkie-production.up.railway.app`. Put that host into `X_REDIRECT_URI`
above if you had not already.

### 4. Register the callback with X

In the X developer portal, add your exact callback to the app's allowed redirect
URLs:

```
https://<your-railway-domain>/auth/x/callback
```

Redeploy after any variable change.

### 5. Verify

- `https://<domain>/` loads the app.
- `https://<domain>/api/reserve` returns the cBTC and cETH reserve as JSON, with no
  login. This proves the server can reach the ledger.
- Click **Continue with X** and confirm you land back signed in.

## Part B. Vercel edge (optional)

Use this only if you want the app served from Vercel's CDN or a custom domain. It
proxies API and auth calls back to Railway, so the browser stays on one origin and
the login cookie keeps working.

1. Edit `web-vite/vercel.json` and replace both `YOUR-RAILWAY-DOMAIN.up.railway.app`
   occurrences with your real Railway domain.
2. In Vercel, **Add New Project**, import `martinvibes/Selkie`, set the **Root
   Directory** to `web-vite`. Vercel reads `vercel.json` and builds with Vite.
3. This makes the Vercel domain your public front door, so switch the login origin
   to it: set `X_REDIRECT_URI=https://<your-vercel-domain>/auth/x/callback` on
   Railway, and add that same URL to the X app's callbacks.

CLI alternative:

```bash
cd web-vite
vercel            # link and deploy a preview (authenticates as you)
vercel --prod     # promote to production
```

## Part C. Telegram bot (optional second service)

The bot is a separate long-running process. To host it on Railway instead of a
laptop, add a second service to the same project:

- Start command: `node bot/src/index.mjs`
- Give it the same Canton and ledger variables as the web service, plus
  `TELEGRAM_BOT_TOKEN`.
- It does not need `PORT`, X keys, or the web app.

## Security checklist

- [ ] `SELKIE_DEV_LOGIN` is not set anywhere public.
- [ ] `SELKIE_SECURE_COOKIES=1` on every HTTPS deployment.
- [ ] `SELKIE_SESSION_SECRET` is set to a long random value.
- [ ] `X_REDIRECT_URI` matches a URL registered in the X app, and points at your
      real public domain.
- [ ] Secrets live only in the host's variables, never in the repo.
- [ ] Rotate the DevNet, X, and Telegram credentials after the hackathon.
