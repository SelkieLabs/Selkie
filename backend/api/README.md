# backend/api

The backend every surface calls: the web app, the X bot, and the Telegram bot.
It owns who someone is. It does not own how money moves; that is the chain
adapter's job.

## The account model

**One person is one account with one wallet and a list of identities.**

Identities do two different jobs, and conflating them is what makes these
systems confusing:

| Provider | A door you log in through | An address people can pay |
| --- | --- | --- |
| Google | yes | no |
| X | yes | yes |
| Telegram | yes | yes |

Nobody sends money to a Gmail address, so a Google-only account can hold and
send but cannot be paid at a handle until it links one.

### Why linking is the product, not a settings page

Linking an X account proves the handle belongs to that person. That is exactly
the proof the escrow contract needs, so the moment someone links X, anything
that was waiting for their handle lands in their wallet. "You had $15 waiting"
is the reason people link, and it is also the security model.

### How one person avoids ending up with two wallets

The failure everyone hits: sign up with Google today, come back next week, tap
"continue with X", and quietly get a second account with your money in the wrong
one. Three rules prevent it:

1. **Nothing is created silently.** An identity we have never seen returns
   `no-account`, and the UI asks once before creating a wallet. That screen
   doubles as terms acceptance, so it costs nothing.
2. **Nothing is merged silently.** If you link an identity that already has an
   account, you get `merge-required` and a prompt, never a surprise transfer.
3. **Confirmed merges move money first.** The sweep happens before identities
   move and before the old account closes, so funds are never stranded in an
   account that no longer exists.

### Handles get renamed

Every identity is keyed on the provider's permanent user id, never the @handle.
X handles get released and re-registered; keying on the string would eventually
hand someone else's money to a stranger. A rename updates the username in place;
a different user id who later takes that handle is a different person and gets
their own account. Both cases are covered by tests.

## Sign-in and wallets: Privy

Privy is the only major embedded-wallet provider that covers all three of our
identity types (Google, X, Telegram) **and** issues Stellar wallets. That second
part matters: Stellar is ed25519 and most providers are EVM-first. Keys live in
a TEE with Shamir's Secret Sharing, so Selkie never holds a user's private key.

What we take from Privy is proof of identity and a wallet address. What linking
*means* is ours: Privy has no idea that attaching an X account releases escrowed
money. That logic sits behind the `IdentityProvider` interface, so Privy can be
replaced without touching the account model.

## Sessions

Selkie issues no session tokens of its own. The client sends the provider's
access token as a bearer token and the server verifies it. Rolling our own
session format would be one more thing to get wrong, and auth bugs are how money
apps actually get robbed.

Verifying means verifying. The token is an ES256 JWT, checked against the app's
public key, with the algorithm read from what we require rather than from the
token's own header, the issuer pinned to Privy, the audience pinned to this exact
app, and no grace period on expiry. Only then is the user looked up by the
subject it carries, using app credentials. There is no endpoint that trades a
user token for a user, and a token that is merely shaped right proves nothing.
`privy.test.ts` is the attack list.

## Routes

| Route | What it does |
| --- | --- |
| `POST /auth/session` | Sign in. Returns `no-account` for an unknown identity unless `createAccount` is set. |
| `POST /auth/link` | Link another identity. Releases waiting money, or returns `merge-required`. |
| `POST /auth/merge` | Confirmed merge. Separate because it moves money. |
| `GET /me` | The signed-in user and their balances. |
| `GET /handles/:username` | Who a handle belongs to, for the confirm screen. |
| `POST /payments/send` | Pay a handle. The adapter decides direct vs escrow. |
| `GET /payments/convert/quote` | What one asset is worth in another, quoted by the network. |
| `POST /payments/convert` | Convert one asset into another. |
| `GET /activity` | The activity feed, newest first. |

### Two of those need a word

**`GET /handles/:username`** exists because a mistyped handle is the most common
way people lose money in an app like this, and the only defence that works is
showing a face and a name before the money moves. A handle nobody has claimed is
still a valid destination, so it answers "we do not know them yet", never "no".

**`GET /activity`** reads a table Selkie writes, not the ledger. Money released
by the escrow contract moves inside a contract call and never appears in a
classic payment feed, so reading history back off the chain would show fewer
events than actually happened, described worse. The store writes the entry at the
moment it does the thing, for both sides of a payment.

Responses never include provider subjects or anything else internal, and there
is a test that asserts it.

## Running it

```
PRIVY_APP_ID=... PRIVY_APP_SECRET=... \
SELKIE_SPONSOR_SECRET=... SELKIE_ORACLE_SECRET=... \
npm run dev:api
```

Config is read once at boot, so a missing value fails loudly on start rather
than quietly at the moment someone tries to send money. The escrow contract id
comes from `contracts/deployments/<network>.env` unless overridden.

The user store is in memory today. It is an interface (`UserStore`), and
Postgres is the only implementation that needs to change.
