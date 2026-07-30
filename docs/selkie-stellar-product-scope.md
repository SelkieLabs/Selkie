# Selkie on Stellar: Product Scope

_Pure product doc. What Selkie is, who it serves, and what it does. No grant milestones or reward tiers here, just the idea._
_Last updated 2026-07-29._

---

## 1. One line

**Selkie lets you send money to anyone by their social handle. No app to download for them, no wallet to set up, no seed phrase, no gas. If they have never heard of Selkie, the money simply waits until they sign in with their X or Telegram account and claim it.**

Money in Selkie is a stablecoin (USDC on Stellar), so a dollar stays a dollar. From there you can cash out to local money, buy airtime and data, pay bills, or swap into what you need.

---

## 2. The problem

Sending money to a normal person with crypto is still broken in two places:

1. **The sender wall.** Wallets, seed phrases, gas tokens, and copy-pasting 56-character addresses. One wrong character and the money is gone forever. Most people give up before they start.
2. **The recipient wall.** Even if you are set up, the person you want to pay usually is not. They need to download an app, create a wallet, back up a seed phrase, and often already own some crypto for gas, all before they can receive a single cent.

Every payment app asks *both* people to be inside the app first. That is the friction that keeps normal people out. Selkie removes both walls.

---

## 3. The core idea: your handle is your account

You already have an identity people know you by: your X handle or your Telegram username. Selkie makes that handle spendable.

- **Sign in with X or Telegram.** That is your whole onboarding. Behind the scenes Selkie creates a Stellar account tied to your handle. You never see a seed phrase.
- **Pay by handle.** Send to `@someone` the same way you would mention them. No addresses.
- **The recipient needs nothing.** If they have not joined, the money is held for that exact handle and waits. When they later sign in with that same account, it is theirs. Because signing in proves they own the handle, only the real owner can ever claim it.
- **No gas, no XLM.** Selkie covers the network fees and the account setup in the background. Users only ever see and hold dollars.

That is the magic, and it is the one thing no other Stellar payment app does today (more on that in section 7).

---

## 4. Who it is for

- Everyday people in emerging markets (starting with Nigeria and nearby) who live on their phones and on X and Telegram.
- People sending money to friends, family, and small sellers who are not crypto users.
- The diaspora sending money home.
- Small creators, communities, and sellers who want to get paid by their audience without asking everyone to install anything.

The common thread: people who want the usefulness of digital dollars without the crypto learning curve.

---

## 5. How it works, in plain terms

**Getting in:** Tap "Sign in with X" (or Telegram). Selkie sets up your dollar account. Done. You can receive money immediately, even before you have added a cent.

**Sending:** Type who and how much (`@martin 10`). Selkie finds their handle and moves the dollars.
- If they are a Selkie user, it lands instantly.
- If they are not, it is set aside for their handle and they get a nudge to claim it. Nothing is required from them except signing in when they are ready.

**Receiving and claiming:** New users sign in with the handle that was paid, and the waiting money becomes theirs. Old, never-claimed payments can be returned to the sender after a set time, so money is never truly stuck.

**Cashing out and spending:** From your balance you can turn dollars into real-world value: local cash, airtime, data, or bills (section 6).

**Where privacy stands, honestly:** Stellar is a public ledger, so Selkie does not promise secret balances. What Selkie does promise is practical privacy: people pay your *handle*, not a visible wallet address, Selkie never shows your balance or address to the person paying you, and public replies on X never show amounts. That is real and useful, and we will not claim more than that.

---

## 6. The surfaces and the features

Selkie meets people where they already are. Same account, three doors.

### The three surfaces
- **X (@SelkiePay):** pay someone straight from a tweet or a DM. Best for public, social, "I got you" moments.
- **Telegram (@selkiepay_bot):** pay inside chats. Best for private day-to-day sending in the region where Telegram is huge.
- **Web app:** the full dashboard. Balance, history, cash out, bills, swap, settings.

### Core features (the heart)
- **Send and receive by handle**, across all three surfaces.
- **Claim-by-login** for people who are not users yet.
- **No seed phrase, no gas**, dollar balances.
- **Cash out** to local money through licensed local partners (bank transfer, mobile money).

### Airtime and bills (your idea, and a strong one)
Buy airtime and data, and pay bills (electricity tokens, TV, and similar) straight from your Selkie balance.

Why this is a smart wedge, not just a nice-to-have:
- In our markets, **airtime is almost a second currency.** Turning dollars into airtime is instant, needs no bank account, and is useful to literally everyone with a phone. It is effectively a cash-out that skips the hard banking rails.
- It is **low-value, high-frequency, and low-friction**, which is exactly what drives everyday habit and word of mouth.
- It gives people a reason to keep a balance in Selkie even before they care about "crypto."

How it works: Selkie connects to an established bills-and-airtime provider that accepts stablecoin or local currency and delivers the top-up or bill payment. Selkie is the friendly front door, the licensed provider handles the actual telco and utility rails.

One design rule I would insist on: **airtime and bill commands carry private data (phone numbers, meter numbers), so they must never happen in a public tweet.** Route them through Telegram, a DM, or the web app only. Doing this on the public X timeline would leak personal details.

### Swap and exchange (your idea, with one clarification)
"Swap" and "exchange" can mean two different things, and Selkie should offer both but label them clearly so users are never confused:
- **Swap (crypto to crypto):** turn one Stellar asset into another, for example a local-currency stablecoin into USDC, using an existing Stellar swap service. Useful when someone receives an asset that is not the dollars they want to hold.
- **Exchange (money in and out):** buy digital dollars with local currency, or sell them back to local currency, through the same licensed cash-in and cash-out partners. This is the on-ramp and off-ramp.

Most everyday users care about the second one. The first is a power feature. Keep the wording simple: "Add money," "Cash out," and "Convert."

### Natural next features (candidates, not commitments)
- **Request money:** a link or a handle-to-handle request, so someone can pay you back or a seller can collect.
- **Savings:** let idle dollars earn a little yield through an existing Stellar savings protocol.
- **Split and group pay:** useful for the community and creator angle.

I would hold these until the core plus airtime is loved, so Selkie stays focused (see section 9).

---

## 7. What actually makes Selkie different

This matters, because the space is crowded. Here is the honest landscape on Stellar today:

- **Peer (HoneyCoin):** send, receive, swap, airtime, bills. Almost the same utility list as ours.
- **Stax:** send money, airtime, bills, online and offline, across Africa. SDF-backed.
- **StellarPay:** send money by a username ("StellarTags").
- **Vibrant:** send USDC by phone number.
- **Paysapp:** send Stellar assets over WhatsApp and Telegram.
- Plus a long line of funded African payment and remittance apps (SurgePay, Bonafide, Centiiv, Leaf, Fonbnk, and more).

So the utilities (airtime, bills, swap, cash out) are **table stakes**, not a differentiator. Even "pay by username" already exists. If Selkie is just "another payments app with airtime and swap," it blends in.

**Selkie's real, defensible difference is the identity and onboarding model:**

1. **You pay the handle a person already has.** Not a username they had to create inside yet another app. Their existing X or Telegram identity.
2. **The recipient needs nothing to receive.** No app, no wallet, no signup. Everyone else needs both people inside their app first. Selkie is the only one where the person receiving can be a complete stranger to the product and still get paid, then claim later by simply logging in.
3. **The payment happens inside the social apps themselves,** not only in a standalone app. You pay from the tweet, from the chat. That is a distribution advantage: Selkie can spread through the timeline and through group chats, not just through app-store installs.

Everything else (airtime, bills, swap, cash out) sits on top of that wedge as the reasons to stay. The wedge is what gets people in the door for free.

---

## 8. Trust and safety model

- **Non-custodial where possible.** Users control their own accounts. Money waiting for an unclaimed handle is held by a neutral on-chain mechanism, not pooled in a company wallet, and returns to the sender if never claimed.
- **Licensed partners do the regulated parts.** Selkie is the friendly interface. Cash in, cash out, airtime, and bills run through providers that hold the right licenses. Selkie is not trying to be a bank or a money transmitter itself.
- **Handle ownership is proven at claim time.** Because you claim by signing in with the exact account that was paid, money can only be released to the true owner of that handle, which blocks the obvious "claim someone else's money" attack.
- **Honest privacy.** UX-level privacy as described in section 5, not a false promise of a secret ledger.

---

## 9. Honest open questions and risks (the "tell me if it doesn't make sense" section)

You asked me to flag anything shaky. Here is where I would push back or slow down:

1. **Scope focus.** Send, receive, claim, cash out, airtime, bills, swap, exchange, three surfaces, is a large surface area for a young product. Peer and Stax do this with teams and funding. I would ship the wedge first (handle-to-handle send, receive, claim, cash out) and airtime, get people to love it, then add bills, then swap and exchange. Trying to launch all of it at once is the most likely way to ship something mediocre.
2. **Crowded market.** This is a well-funded, competitive category on Stellar. That is a signal it is a real market, but it means Selkie only wins on the wedge, not on the feature checklist. Every piece of messaging should lead with "pay anyone by their handle, they need nothing," not "we also do airtime and swap."
3. **Regulation and custody.** The moment you touch cash out, bills, and exchange, you are near money-transmission and KYC rules. Staying non-custodial and leaning on licensed partners is not just cleaner, it is what keeps Selkie out of trouble. This needs to be a deliberate design constraint from day one, not an afterthought.
4. **Airtime and bills privacy.** Repeating it because it matters: never on the public timeline. Phone and meter numbers belong in private surfaces only.
5. **Impersonation and look-alike handles.** People fat-finger handles and scammers make look-alikes. Claim-by-login protects the *release* of funds, but the sending screen should clearly show who they are about to pay, and misdirected or unclaimed payments must be refundable.
6. **The privacy story.** On Canton, "private by default" was true. On Stellar it is not, and a technical audience will notice if we overclaim. We lead with the handle and onboarding magic, and we describe privacy honestly. I will keep us consistent on this.

None of these are reasons not to do it. They are the things to get right so the idea stays solid instead of turning into a me-too app.

---

## 10. The shape of it, in one paragraph

Selkie is the simplest way to send digital dollars to a real person: you pay their X or Telegram handle, and they receive it even if they have never touched crypto, claiming it later just by logging in. Once people are in, Selkie becomes the place they hold dollars and turn them into what they actually need, cash, airtime, data, bills, or a quick swap, all without seed phrases or gas. The utilities keep people around. The handle is what gets them in the door, and that door is the part no one else on Stellar has built.
