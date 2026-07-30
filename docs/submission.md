# Selkie: HackCanton S2 submission pack

Paste-ready copy for the project dashboard at hackathon.appsfactory.cc.
Everything here is checked against the running build on 2026-07-22.

The live project record still says "Sotto" in four places, still promises
escrow and bill splitting that we did not build, and its MVP material is
empty. It was last touched on Jul 17, before the Canton 3 port, the real
cBTC settlement, the Telegram bot and the current UI. This file replaces it.

Submission closes **2026-07-26 21:59 UTC**. The project is currently in
`preview`, which means it is not in front of judges yet.

---

## 1. Elevator pitch

> Selkie turns any X or Telegram handle into a private wallet on the Canton
> Network. Send Canton Coin, USDCx, cBTC or cETH to @anyone. If they have
> never heard of Selkie, the payment itself creates their wallet the moment
> it lands, so there is nothing for them to claim and nothing to install.
>
> Reward campaigns leak value at one specific place: the claim step. Between
> 20% and 40% of airdrop and reward value is never collected, because
> collecting it means installing a wallet, saving twelve words, buying gas
> and pasting an address. Selkie removes the claim step entirely. The
> recipient's wallet is created inside the same atomic transaction that pays
> them.
>
> Social money has a second problem, and it is the one that keeps businesses
> off public chains: on a transparent ledger every tip, balance and payout
> becomes public feed data. Selkie is built on Canton because privacy is the
> default there, not a feature bolted on top. Amounts are visible only to the
> two parties in a payment. Our receipt page returns "no such payment" to
> everyone else, including a signed in stranger, and a handle's public page
> proves only that it can be paid.
>
> Working today on Canton 3.5.9: one tap sign in, pay any handle, ask a
> handle to pay you, pay a whole list of winners at once, and a live cBTC
> reserve settled through the CIP-56 token standard on the shared devnet
> node.

Character count is close to the existing field, so it should drop straight in.

---

## 2. MVP material (currently empty, this is the one judges read first)

**What runs right now**

| Capability | State | How to check it |
| --- | --- | --- |
| Handle to wallet, no setup | Live on Canton 3.5.9 | `node bot/scripts/demo-chat.mjs` |
| Pay a handle with no account | Live, wallet created in the same transaction | 20 winners paid, 20 onboarded, 0 unclaimed |
| Ask a handle for money | Live, settles only on the payer's approval | Requests tab, or `request 10 CC from @ada` in the bot |
| Reward campaign to a list | Live over HTTP and Telegram | Campaign tab, or `/campaign` in the bot |
| Real cBTC on devnet | Settled, 2.0 CBTC held | `curl localhost:4000/api/reserve` |
| Fund from an outside Canton wallet | Live, receives at one party with a handle tag | Deposit tab |
| Private receipts | Enforced by the ledger, not the UI | Open another account's `/tx/:id`, get 404 |
| Telegram | @selkiepay_bot is live | Message it |
| X sign in | Real OAuth2 PKCE against Martin's X app | `/auth/x/login` |

**Proof that the cBTC is real, not a label**

Selkie holds 2.0 cBTC on the HackCanton shared devnet node, accepted through
the CIP-56 token standard. Three faucet transfer offers were accepted by
exercising `TransferInstruction_Accept` with choice contexts fetched from the
DA Utility Registry, then a 0.1 cBTC transfer was settled through
`TransferFactory_Transfer` to prove the send path end to end.

Ledger update ids:

```
1220c66531a3dd8369c94fb6fdfee6b43f22b1c8fc9867f632e8ce77be4a4fbe3c
1220f79f7d18ff74a013f9c7ce11edf34dba1aebe8c0516b82de4be436344aecb3
12205ecfd75f1820753b38f0618f6351f22e10c5d8853f3da0c14c07a76cdf1929
12203c83a812b556fa9dd5159422968b0fa0fbe2c0139f0bd60f437ec732bc0258e6
```

`GET /api/reserve` is public and unauthenticated on purpose: it reads the
holdings straight off the ledger, caches for 30 seconds, and returns 503 if
the ledger is unreachable rather than reporting a comfortable zero.

**Proof that the whole wallet runs on real Canton, not a laptop sandbox**

Selkie's own DAR is uploaded to the shared HackCanton devnet participant, and
the organiser granted us several real parties on it. Running Selkie's wallet
logic against that node, with no code changes, only configuration:

- Two handles become two distinct Canton parties and open real accounts on
  the shared node.
- One is credited, then pays the other. The payment settles on devnet.
- A third party hosted on the very same ledger is then shown to see zero of
  the recipient's holdings, while the operator, who co-signs, sees them. The
  private-balance claim is verified on a network we do not control.

This is a single repeatable script, `bot/scripts/devnet-demo.mjs`, that prints
the whole thing. It is the difference between "it works on my machine" and "it
works on Canton".

And a real cBTC deposit was carried the whole way in: one party sent 0.1 cBTC
to a Selkie user's deposit address, tagged with their handle, and the wallet
claimed it by accepting the CIP-56 transfer instruction and crediting the
handle. The user's cBTC balance went from 0 to 0.1 in the browser, and the
reserve settled back to 2.0. Money entered Selkie from a separate Canton
party, through the token standard, end to end.

**Engineering state**

- 70 tests green against a live Canton 3.5.9 participant: 44 in the bot
  including a twelve test live integration suite, 26 in the server including
  a twenty winner campaign over HTTP.
- A payment request is a contract, not a message. Asking moves nothing; the
  payer's approval is a single transaction that creates the transfer and
  executes it, so there is no window where the money is neither theirs nor
  yours. Only the named payer can approve, and the ledger enforces that, not
  our server.
- Ported from the Daml 2.x sandbox to Canton 3. That meant Daml-LF 2.x,
  losing contract keys entirely, and rewriting the client for JSON Ledger
  API v2. The one handle equals one wallet invariant now comes from an
  `AccountDirectory` template whose consuming choice serialises registration,
  with the account created in the same transaction so a rollback leaves no
  orphan.
- Two surfaces on one core: `bot/src/dispatch.mjs` is shared by Telegram and
  the web server, so both speak to the same wallet logic.

**Honest limits**

- On the shared devnet node we cannot allocate parties or upload code
  ourselves, both are admin operations. The organiser did both for us, so the
  multi party demo now runs on devnet, but new handles beyond the parties the
  organiser hosted can only be created on LocalNet or on a validator we run.
- Escrow and bill splitting are designed but not built. The old pitch
  promised them. This one does not.
- Custody is honest but not final. Selkie receives every deposit at one
  Canton party and tracks who owns what in its own contracts, which is an
  omnibus model, not a per user address. On a validator we run, and on
  LocalNet today, every handle already gets its own real Canton party, and the
  devnet run above uses one real party per user, so per user deposit addresses
  are the natural next step, not a rewrite.
- Withdrawal to an outside wallet is the other half of this and is not built
  yet. The send path itself is proven, since a cBTC transfer was settled
  through `TransferFactory_Transfer`.

---

## 3. The six gate materials

**Problem.** Reward and airdrop campaigns lose 20% to 40% of their value at
the claim step, because claiming demands a wallet install, a seed phrase, gas
and an address. On transparent chains the payouts that do land become public
data, which is why most brands will not run them on chain at all.

**ICP.** Crypto community managers on X who run weekly reward campaigns.
Persona: "Dara", who pays 20 to 50 contributors a week, chases people who
never claimed, and cannot show her finance lead a payout sheet that is also
public. Normal users arrive as recipients, not as signups. That is the wedge.

**Validation.** The metric we can prove rather than assert: a twenty winner
campaign on real Canton settles 20 out of 20 paid, 20 out of 20 onboarded,
0 unclaimed. Every one of those recipients had no wallet before the payment.
Competitor scan of the 27 registered S2 projects: all of the others are
institutional B2B, so Selkie is the only consumer social wallet in the field.

**GTM.** Land through campaign runners, not through end users. A community
manager brings 20 to 50 wallets per campaign at zero acquisition cost, and
those recipients already hold a balance when they arrive. Distribution is the
handle itself: every payment is a public mention of an unclaimed wallet.
Telegram is the second surface for communities that live there.

**Demo.** Script in section 4. Under three minutes, live, no mocks.

**Pitch.** Section 1.

---

## 4. Demo video script, under three minutes

Record at 1440 by 900 with LocalNet up and the server on :4000.

**0:00 to 0:20, the problem.** Landing page, scroll once so the water
darkens. Voiceover: "Paying someone in crypto means asking them to install a
wallet, save twelve words and buy gas. Between twenty and forty percent of
reward money is never claimed. Selkie deletes that step."

**0:20 to 0:45, one tap in.** Click Continue with X, land on the wallet.
"My handle is my wallet. No install, no seed phrase, no gas."

**0:45 to 1:20, pay someone who does not exist yet.** Send tab, pay a handle
that has never used Selkie. Open the receipt. "Their wallet was created
inside the same transaction that paid them. There was nothing to claim."

**1:20 to 1:40, money goes both ways.** Requests tab, ask a handle for 3 CC,
then switch accounts and tap Pay. "Asking moves nothing. Approving is one
transaction that creates the transfer and settles it, so the money is never
in limbo, and only the person I asked can approve it."

**1:40 to 2:10, privacy is the ledger's job.** Copy the receipt link, open it
from another signed in account, show the refusal. "On Canton a payment is
visible only to the two people in it. This is not a UI rule. The ledger
enforces it."

**2:10 to 2:35, real cBTC.** Show the reserve line on the dashboard, then
`curl localhost:4000/api/reserve` in a terminal. "Two real cBTC, settled
through the CIP-56 token standard on the HackCanton devnet node. This number
is read from the ledger, not typed by us."

**2:35 to 3:00, scale and close.** Campaign tab, paste twenty handles, pay
them all. "Twenty winners, twenty wallets created, nothing unclaimed. If you
have a handle, you have a wallet."

---

## 5. Two things worth doing on the platform

**Attach the cETH challenge as well.** Only the cBTC challenge is attached
today. The cETH challenge is a separate 50,000 CC pool and the same registry
machinery we already built would drive it. Selkie now has a real devnet party
that has already received real tokens, so the cETH request form can finally
be filled in honestly:

```
c699b723-4b03-42ef-98e8-244465658339::122003aa7c491e00a453145c4d2cd3dbf5db8908b4e663c9944baed57fd66effa668
```

**Fix the record's smaller fields.** `socials.telegram` is empty although
@selkiepay_bot is live. `techStack` lists Python and AI Agents, neither of
which Selkie uses, which is the kind of detail a technical judge notices.
Accurate stack: DAML, Canton Network, Canton 3.5.9, JSON Ledger API v2,
CIP-56 token standard, cBTC, Node.js, React, Vite, TypeScript, Tailwind,
Telegram Bot API, X OAuth2 PKCE, Docker.

---

## 6. Diary entry for today

> Day 7. Shipped the real thing today: Selkie now holds 2.0 cBTC on the
> HackCanton devnet node, accepted through the CIP-56 token standard rather
> than minted as a label in our own contracts. The unlock was the DA Utility
> Registry choice context API, which hands back the disclosed contracts you
> need before exercising `TransferInstruction_Accept`. Proved the send path
> too with a 0.1 cBTC transfer through `TransferFactory_Transfer`.
>
> That made a public endpoint possible. `GET /api/reserve` reads the holdings
> straight off the ledger and returns 503 if the ledger is unreachable,
> because a payments app that reports a comfortable zero when its ledger is
> down is worse than one that admits it is down.
>
> Also rebuilt the interface around the idea that a wallet can be a place
> rather than a form. The whole app now sits in a moonlit cove drawn in SVG,
> and the landing page reads as a descent: the light recedes, the sea floor
> rises, the water darkens, and a gauge on the right counts how deep you are.
>
> 53 tests green against a live Canton 3.5.9 participant.

Next entry, for the day after:

> Money now goes both ways. Until today Selkie could only push: you paid a
> handle. Now a handle can ask you, and that ask is a contract rather than a
> message. Asking moves nothing. The payer's approval is a single transaction
> that creates the transfer and executes it, so there is no moment where the
> money belongs to neither side, and the ledger itself refuses an approval
> from anyone who is not the person who was asked.
>
> It is live on both surfaces from the same code: `request 10 CC from @ada`,
> `requests` and `approve` in Telegram, and a Requests tab in the wallet with
> a badge for how many people are waiting on you.
>
> The honest part of the story is that the template had been sitting compiled
> and deployed on the ledger for days with nothing able to reach it, and the
> bot was answering its own advertised command with a promise. Wiring what
> you already built beats starting something new.
>
> Also opened the door the other way. Until today money could only appear in
> Selkie because Selkie put it there. Now the wallet has an address on Canton
> devnet, and a transfer sent to it with your handle in the metadata becomes
> your balance once it is accepted. A transfer that names nobody is shown and
> left alone, because guessing who real money belongs to is not a feature.
>
> 70 tests green against a live Canton 3.5.9 participant.
