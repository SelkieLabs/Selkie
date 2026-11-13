# NEAR HACKATHON submission (drafts)

Drafts only. Nothing here has been submitted or posted. The human submits the
form and posts on X. Deadline: 2026-11-14 23:59 UTC (Sunday 00:59 in Lagos).

## Project

- **Name:** Selkie
- **One line:** Send money to any X handle, from the app or from a tweet. The
  person you pay needs no wallet, no app and no gas. Their NEAR account is created
  when they sign in with X, and its only key is theirs.
- **Tracks:** realworld (primary), agents (the X bot pays from a capped on-chain
  pocket, live on testnet). Social only once a DAO payout has actually run on
  testnet (`npm run near:dao`): it is built, but not yet executed.
- **Repo:** https://github.com/SelkieLabs/Selkie
- **Hosted demo:** https://selkiepay.com
- **Diff of hackathon work:** https://github.com/SelkieLabs/Selkie/compare/3525dc8...main

## What did you build? (form text, 20 to 2000 characters)

> To pay someone in crypto you need their address, and most people don't have
> one. Selkie lets you pay an X handle instead, from the web app or from a tweet.
>
> If @amaka has never used NEAR, the USDC waits in our escrow contract under a
> hash of their X user ID (or their handle when the ID can't be looked up). When
> they sign in with X, Privy creates an embedded NEAR wallet in their browser,
> Selkie creates amaka.x.selkiepay.testnet with that public key as its only key,
> and an oracle releases the waiting money into it. Selkie never sees a private
> key: the explorer and `npm run prove:keys` show it.
>
> Nobody pays gas. The browser signs a NEP-366 delegate action, and Selkie's
> relayer submits it only if it matches, byte for byte, what the server prepared
> for that user.
>
> Tweet to pay: "@SelkiePay send 2 to @amaka" pays on the spot from an X pocket,
> a small capped balance in our pocket contract. The bot's key can only call
> pocket_send, only up to your daily limit, only to Selkie accounts. Otherwise
> the bot replies with a link you sign, then replies again in the thread once it
> lands, tagging the person paid. "@SelkiePay request 5 from @amaka" makes the
> ask straight away.
>
> NEAR does the heavy lifting: named accounts make a handle an address;
> per-account keys make "Selkie holds no key" checkable; meta-transactions make
> it gasless; ft_transfer_call lets the escrow and the pocket take money and
> record what it is for in one step; NEAR Intents (1Click) brings money in from
> 10 chains and cashes out to them, or to a bank account in Nigeria, Kenya,
> Uganda or Tanzania through Paycrest.
>
> Also built: pay up to 20 people with one signature, DAO payouts by handle
> through a Sputnik proposal, push and email notices.
>
> Selkie existed on Stellar before the hackathon. All NEAR work is new, and the
> README links the diff.

## X post draft

> To pay someone in crypto you need their address. Most people don't have one.
>
> Selkie: pay any X handle on @NEARProtocol, even by tweeting
> "@SelkiePay send 2 to @friend". They sign in with X, their account
> friend.x.selkiepay.testnet appears with the money in it, and its only key is
> theirs. No gas, no seed phrase.
>
> Built at NEAR HACKATHON #NEARHackathon
>
> 🎥 [video]
> Repo: https://github.com/SelkieLabs/Selkie
> Try it: https://selkiepay.com

## Video script (about 2 minutes 15 seconds)

Two people: **A** on a laptop (has used Selkie, has an X pocket) and **B** on a
phone (has never used Selkie or NEAR). Use real X accounts.

| Time | Shot | Say |
| --- | --- | --- |
| 0:00 | Title card, or the landing page | "To pay someone in crypto you need their address. Most people don't have one." |
| 0:10 | A opens Send, types @B and 2, signs. The row reads "Waiting for @B". | "So pay their X handle. B has never used NEAR." |
| 0:25 | B on the phone: selkiepay.com, Sign in with X. The account `B.x.selkiepay.testnet` appears with 2.00 and "was waiting for you". | "B signs in with X. Their NEAR account is made right there, with the money in it." |
| 0:45 | B's balance card: "Keys on this account: 1, yours". Tap through to the explorer: one access key. Terminal: `npm run prove:keys -- B.x.selkiepay.testnet`. | "One key, and it's B's. Selkie holds none. Check it yourself." |
| 1:00 | A's activity: the row flips from Waiting to Claimed. | "No gas for either of them. Selkie's relayer pays it." |
| 1:05 | On X, A tweets "@SelkiePay send 1 to @B". The bot replies with the explorer link in about 15 seconds. Show the Tweet to pay tab: balance, daily limit. | "Or just tweet it. It pays from A's X pocket, a small balance with a daily limit. The bot can't touch anything else." |
| 1:25 | A tweets a send to a handle not on Selkie. The bot replies with a link; A taps it and signs. The bot replies again in the same thread: "Done. 1 USDC is waiting for @C. Sign in with X and it's yours." | "Someone not on Selkie yet? You sign the link, and the bot tells them, right in the thread." |
| 1:45 | A tweets "@SelkiePay request 0.5 from @B". B's Requests tab shows a red 1; B taps Pay. | "Asking works the same way." |
| 1:55 | Cash out: a bank account shows the holder's name and the naira amount (mainnet clip if it has run), or another chain with a live quote. | "Cash out to another chain, or to a bank account, through NEAR Intents." |
| 2:10 | End card | "Selkie. Built at NEAR HACKATHON." |

## Still needed from the human

- Video file or link, and the X post link once posted
- Lead name, email and team size for the form
- NEAR mainnet payout address
- A second NEAR HACKATHON entry? If yes, its name goes in both READMEs
- OK to tag `hackathon-submission` and push the tag
- OK to call the submission API (or submit the form yourself)

## Before submitting

- [x] Repo has LICENSE (MIT)
- [ ] Repo public through judging
- [x] Fresh clone checked 13 Nov: `npm install`, `npm test`, cargo tests, contract build and `prove:keys` all run
- [ ] README test counts match a fresh clone (Postgres tests only run with `DATABASE_URL_TEST`)
- [ ] Hosted demo up through 2026-11-25 (API on Railway, web on Vercel)
- [ ] X bot hosted on Railway, not on a laptop (planned for 14 Nov)
- [ ] Mainnet run: one small payment and one cash out, tx hashes in PROGRESS (needs the human's OK and `selkiepay.near`)
- [ ] DAO payout executed once on testnet, or drop the social track
- [ ] Two-browser loop recorded, `prove:keys` on screen
- [ ] Video attached to the X post, which tags @NEARProtocol and #NEARHackathon
- [ ] Demo video link added to the README
