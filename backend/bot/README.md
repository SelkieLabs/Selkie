# backend/bot

The X surface, with Telegram to follow. Thin on purpose: it parses a message
("send 5 to @amaka"), calls the same API the web app calls, and replies with a
confirmation. No chain code, and no rule about money that the web app does not
also obey.

## How it is put together

| File | What it does |
| --- | --- |
| `parse.ts` | Message to instruction. Pure, no I/O. |
| `respond.ts` | Instruction to a sentence. Surface-agnostic. |
| `selkie.ts` | Calls Selkie's API as the person who sent the message. |
| `x/client.ts` | The X API, signed OAuth 1.0a. |
| `x/worker.ts` | The poll loop and the timeline etiquette. |
| `state.ts` | The last mention handled, so a restart does not replay. |

Adding Telegram means a transport beside `x/` and six lines in `index.ts`. The
parser and every reply are already shared, which is the whole reason they are
separate files.

## How a bot is allowed to act for someone

A bot holds no login for the person who tweeted at it, so it cannot send the
Privy token the web app sends. What it holds instead is X's word: the API said
this numeric author id wrote this text. It restates that in a short-lived signed
token (`@selkie/core`'s `signBotToken`) and the API verifies it as one more
identity provider. Nothing is bolted onto the side of the API, so every guard on
every route still applies: rate limits, idempotency keys, the mistyped-address
check, the escrow rules.

Be blunt about the risk: `SELKIE_BOT_SECRET` can act as any user who has linked
X or Telegram. It is a key to other people's money. So it is narrow by design:

- Payable platforms only. A bot can never present a Google identity.
- Sixty seconds of life, so a token copied out of a log is soon worthless.
- It can act for an account, and it can never **create** one, so a leaked secret
  cannot mint wallets and drain the sponsor's reserves.
- It can never **link** a handle, because linking releases whatever the escrow
  has been holding for it. That takes a real sign-in.

With `SELKIE_BOT_SECRET` unset the provider is not installed and none of this
exists. A deployment that runs no bot should not be holding one.

## Running it

```sh
npm run dev:bot
```

Reads the repo-root `.env`:

| Variable | Meaning |
| --- | --- |
| `SELKIE_BOT_SECRET` | Required. Must match the API's. At least 32 characters. |
| `SELKIE_API_URL` | Selkie's API. Defaults to `http://127.0.0.1:4000`. |
| `SELKIE_WEB_URL` | Where people are pointed to open their wallet. |
| `SELKIE_BOT_DRY_RUN` | `1` by default. Set `0` to let it post. |
| `X_API_KEY` / `X_API_SECRET` | OAuth 1.0a consumer credentials. |
| `X_ACCESS_TOKEN` / `X_ACCESS_SECRET` | @SelkiePay's own tokens, needed to post. |
| `X_HANDLE` | Defaults to `SelkiePay`. |
| `X_POLL_SECONDS` | Defaults to 30. |

**Dry run is on unless you turn it off.** The two failure modes point opposite
ways: a quiet bot is a bug somebody notices in a minute, and a bot loose on a
public timeline with a payment API behind it is not something you can take back.

The X surface starts only when all four `X_` credentials are present, so one
process can run X today and X and Telegram tomorrow with no flag to remember.

## What it will and will not say

Nothing private goes on a timeline. A balance and a history are answered with a
pointer to the app, never with the number: a public balance is a public
invitation. Airtime, bills, and anything with a phone or meter number are DM
only when they arrive; the public reply just confirms it is done.

Unrecognised text gets no reply at all. Most mentions of a payments bot are
people talking about it rather than to it, and answering each one is noise on
the timeline and a bill for every post.
