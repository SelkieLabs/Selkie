# NEAR HACKATHON submission (drafts)

Drafts only. Nothing here has been submitted or posted. The human submits the
form and posts on X.

## Project

- **Name:** Selkie
- **One line:** Send money to any X handle. The person you pay needs no wallet,
  no app and no gas. Their NEAR account is created when they sign in, and its only
  key is theirs.
- **Tracks:** realworld. Add social only after a DAO payout has actually run on
  testnet (`npm run near:dao`). Agents does not apply: the bot pocket was not built.
- **Repo:** https://github.com/SelkieLabs/Selkie
- **Hosted demo:** https://selkiepay.com
- **Diff of hackathon work:** https://github.com/SelkieLabs/Selkie/compare/3525dc8...main

## What did you build? (form text, under 2000 characters)

> To pay someone in crypto you need their address, and most people don't have
> one. Selkie lets you pay an X handle instead.
>
> If @amaka has never used NEAR, the USDC waits in our escrow contract under a
> hash of their X user ID (or their handle when the ID can't be looked up).
> When they sign in with X, Privy creates an embedded
> NEAR wallet in their browser. Selkie then creates amaka.x.selkiepay.testnet with
> that public key as the account's only key, and an oracle releases the waiting
> money into it. Selkie never sees a private key. Anyone can check this on the
> explorer, or by running `npm run prove:keys`.
>
> Users pay no gas. The browser signs a NEP-366 delegate action and Selkie's
> relayer submits it. The relayer only accepts actions that match, byte for byte,
> what the server prepared for that user: USDC or escrow calls only, at most
> 1 yocto attached, capped gas, single use.
>
> NEAR does the heavy lifting:
> - named accounts turn a handle into a readable address;
> - per-account access keys make "Selkie holds no key" checkable;
> - meta-transactions make it gasless;
> - ft_transfer_call lets the escrow receive money and record who it waits for
>   in one step;
> - NEAR Intents (1Click) brings money in from 10 chains and cashes out to them.
>
> Also built:
> - pay up to 20 people with one signature;
> - DAO payouts by handle through a Sputnik proposal;
> - an X bot that replies with prefilled links and never spends;
> - push and email notices when money arrives.
>
> Selkie existed on Stellar before the hackathon. All NEAR work is new, and the
> README links the diff.

## X post draft

> To pay someone in crypto you need their address. Most people don't have one.
>
> Selkie: pay any X handle on @NEARProtocol. They sign in with X, their account
> amaka.x.selkiepay.testnet appears with the money in it, and its only key is
> theirs. No gas, no seed phrase.
>
> Built at NEAR HACKATHON #NEARHackathon
>
> 🎥 [video]
> Repo: https://github.com/SelkieLabs/Selkie
> Try it: https://selkiepay.com

## Before submitting

- [ ] Repo public, with LICENSE (MIT) present
- [ ] README "Check it in 2 minutes" and "Run it locally" steps run from a fresh clone
- [ ] Hosted demo up (NEAR API deployed, Vercel `SELKIE_API_ORIGIN` pointing at it) through 2026-11-25
- [ ] Two-browser loop recorded: pay a handle, they sign in, the money is theirs, `prove:keys` on screen
- [ ] Video attached to the X post, with the post tagging @NEARProtocol and #NEARHackathon
- [ ] Tag `hackathon-submission` on the submitted commit (the human pushes tags)
- [ ] NEAR mainnet payout address ready (the human provides it)
- [ ] Second NEAR HACKATHON entry by the same builder? If yes, name it in both READMEs
