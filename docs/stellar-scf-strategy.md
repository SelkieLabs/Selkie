# Selkie on Stellar: SCF Build Award strategy

_Working strategy doc. Internal. Last updated 2026-07-29._

## The bet in one line

Take Selkie's core magic (your social handle IS your wallet, pay anyone by @username, no app / no seed phrase / no gas) and rebuild it on Stellar so it can do the one thing Canton cannot easily do for our target users: **cash out to real money (Naira, mobile money, global cash) through regulated on/off ramps.** Then apply to the SCF Build Award on the **Integration Track**.

This is the exact profile SCF is funding right now. The comparable winners we studied:

- **Blink for Merchants** (SCF #44, $75k): proximity crypto payments in West Africa, USDC in, Naira settlement, Nigerian team, ~252 users / 2,360 tx / around $28k volume.
- **Jumpa** (SCF #44, $89.7k): chat-native wallet, social/AI onboarding, integrated Soroswap + MoneyGram/Mercuryo ramp + DeFindex, Nigerian team, small pilot.
- **Azza** (around $89k): stablecoin payments on WhatsApp.

Selkie sits right in the middle of these: social-native payments + emerging-market cash-out. The category is hot and well funded.

---

## 1. The honest reframe: from "private" to "social"

On Canton, our headline was **privacy by default**. That was a Canton-specific feature (Canton is a privacy-preserving ledger). **Stellar is a public ledger.** We cannot truthfully promise confidential balances there, and a technical review panel will catch any overclaim. So we do not lead with cryptographic privacy on Stellar.

The deeper, more durable differentiator was never really "privacy." It was: **you pay a person by their username, and the recipient does not need to already have a wallet, an app, or any crypto knowledge.** That mechanic is what makes Selkie feel like magic, and it maps perfectly onto Stellar's primitives. So on Stellar we lead with:

> **Selkie: send stablecoins to any X or Telegram handle. No app, no wallet, no seed phrase, no gas. If they have not joined yet, the money waits, and they claim it by signing in with their social account. Then cash out to local money.**

**Where privacy still lives (stated honestly):** you share a handle, not a wallet address; Selkie never shows your balance or address to the person paying you or to the public; and we never post amounts in public X replies. That is practical privacy and pseudonymity at the experience layer, which is real and defensible, without claiming ledger-level confidentiality we cannot deliver on a transparent chain. If confidential balances ever matter, Soroban has early confidential-token research, but we do NOT build the grant on that.

---

## 2. Track choice: Integration Track (recommended)

SCF Build has three tracks: Open (novel on-chain, needs a community vote), Integration (compose existing building blocks, panel review only), and RFP (targeted dev tooling). **Go Integration.** Verified specifics from the SCF Handbook:

- **Review is panel-only.** Two reviewers from that quarter's Category Delegate Panel; a third breaks a tie. No community NQG vote to mobilize. That is a much lower bar for a team without an established Stellar following.
- **Requirement: integrate at least one building block from the official SCF Integration List.** We will integrate four to six, which reads as a serious multi-part integration.
- **Budget tiers:** Small $25k to $50k (one simple integration), Medium $50k to $100k (larger integration or two small), Large $100k to $150k (complex multi-part).
- **Structure: 3 tranches**, each subsequent tranche submitted within 90 days of the previous payment. Each tranche needs deliverables + budget + measurable completion criteria.
- **Eligibility gate to respect:** the track explicitly expects **existing user traction** and says "new applications without existing user traction" do NOT qualify. This is the single most important constraint. See section 6.

Blink, Jumpa, and Azza all won through this track. It is the highest-volume award bucket and the clearest fit.

(RFP Track is a possible *second* shot if a live RFP overlaps, for example trustline onboarding or passkey UX. Worth scanning the live RFP list, but the product itself belongs in Integration.)

---

## 3. What to ship, mapped to the official SCF Integration List

The list below is drawn from the real SCF Integration List. Using items from it is what makes us eligible and credible. Our stack:

### Core (Tranches 1 to 2)
| Building block | On official list | What it does for Selkie |
|---|---|---|
| **Privy** | Yes (embedded email / social-based accounts) | Sign in with X, Telegram, or email, and get an embedded Stellar wallet bound to the handle. This is our onboarding magic, and it is a listed integration, not just glue. |
| **Stellar Wallets Kit** | Yes | Wallet connect + SEP-10 auth for the web surface and for power users who bring an existing wallet. |
| **MoneyGram** (+ a Naira anchor via **Anchor Platform**) | Yes | Cash-out. MoneyGram gives global cash and is on the list; for local Naira / mobile money we add a SEP-24 anchor (for example Paychant, live for Nigeria/Ghana/Kenya/Uganda) built on the Stellar Anchor Platform. The off-ramp is the killer feature for our users. |
| **Soroswap** | Yes | If a recipient gets a non-USDC asset, or wants to pay in something else, route the swap to/from USDC. Same integration Jumpa leaned on. |
| **CCTP** | Yes | Let users fund their Selkie balance with USDC from another chain (Base, Ethereum) 1:1. "Bring the money you already have." |

### Native Stellar primitives (architecture, not "integrations", but they impress the panel)
- **Claimable Balances:** money sent to a handle that has not joined sits as a claimable balance until they sign in and claim. This is the native primitive behind "pay someone who is not here yet."
- **Sponsored reserves + fee-bump transactions:** Selkie sponsors the account minimum balance, the USDC trustline, and pays all fees. The user never holds XLM and never learns what a trustline is. This kills Stellar's two biggest onboarding frictions.
- **USDC** (native Circle USDC on Stellar) as the unit of value.

### Stretch (Tranche 3)
| Building block | On list | Use |
|---|---|---|
| **DeFindex** | Yes | Optional yield/savings on idle USDC balances (Jumpa did this). Adds a "savings account" angle. |
| **SDP (Stellar Disbursement Platform)** | Yes | Bulk payouts to many handles at once: creator tips, community airdrops, remittance batches. A differentiator none of the comps have. |
| **Passkey smart wallets** (passkey-kit / Soroban) | SDF-blessed, production (Meridian Pay ran 1,000+ tx) | The north-star security upgrade: Face ID / device passkey instead of any key at all, via Protocol 21 secp256r1. Position as the Tranche-3 hardening, not day-one risk. |

**Why this reads well to a panel:** it is not one integration, it is a coherent everyday-finance flow assembled from listed blocks (onboard with Privy, hold USDC, swap on Soroswap, fund via CCTP, cash out via MoneyGram/anchor), on top of clean native Stellar mechanics. That justifies the Medium-to-Large budget tier.

---

## 4. Architecture (the flow)

1. **Onboard:** user signs in with X or Telegram. Selkie verifies the handle (OAuth) and provisions an embedded Stellar wallet (Privy) bound to it. Backend maps handle to Stellar address. No seed phrase shown.
2. **Pay @handle:** sender types `@name amount`. Selkie resolves the handle.
   - Recipient has an account: direct USDC payment.
   - Recipient has NOT joined: Selkie creates a **Claimable Balance** locked to that handle. When the recipient later signs in, Selkie sponsors their account + USDC trustline and releases the claim. This is the zero-onboarding magic.
3. **Gasless / no XLM:** every transaction is fee-bumped and every reserve is sponsored by Selkie. Users only ever see USDC.
4. **Cash out:** recipient taps "cash out", Selkie hands off to a SEP-24 anchor (MoneyGram for global cash, a Naira anchor for local), and they receive local money.
5. **Three surfaces stay:** X (@SelkiePay), Telegram (@selkiepay_bot), and the web app. "Pay from where you already are" is a differentiator vs Blink (merchant hardware) and Jumpa (single chat app). Telegram especially matters for emerging markets.

Auth model: social OAuth proves handle ownership, which authorizes spending from that handle's wallet. This is already how our Canton bot works (tweet authorship = auth), so the model carries over.

---

## 5. Tranche roadmap (budget, timeline, measurable completion)

Target ask: **around $100k across 3 tranches** (Medium-to-Large tier). Defensible against Blink $75k / Jumpa $89.7k / Azza $89k. If we want to de-risk approval we can scope down to $75k to $90k to match the comps exactly. Each tranche must land within 90 days of the previous payment.

### Tranche 1: MVP on Testnet (~$30k, ~5 weeks)
Deliverables:
- Sign in with X + Telegram, embedded Stellar wallet provisioned per handle (Privy).
- Send USDC by handle on testnet.
- Claimable-balance claim flow for recipients who have not joined.
- Sponsored reserves + fee-bump so the flow is fully gasless and XLM-free.
- Open-source repo, public testnet demo.

Completion criteria (measurable):
- At least 25 test users complete a full send then claim on testnet.
- A 2-minute recorded demo of the end-to-end flow.
- Public repo with the integration code.

### Tranche 2: Ramps + all surfaces (~$35k, ~5 weeks)
Deliverables:
- SEP-24 anchor integrated for on/off-ramp (MoneyGram + a Naira anchor).
- Soroswap swap-to-USDC integrated.
- SEP-10 auth + Stellar Wallets Kit on the web surface.
- All three surfaces live (X, Telegram, web) against testnet/pilot.
- CCTP fund-from-another-chain path.

Completion criteria:
- End-to-end fiat-in, send-by-handle, fiat-out demoed on the anchor sandbox.
- Public beta announced on X with a working link.
- At least 50 users onboarded across surfaces.

### Tranche 3: Mainnet + real traction (~$35k, ~6 weeks)
Deliverables:
- Mainnet launch, real USDC.
- Live off-ramp to Naira / mobile money via the anchor.
- Pilot in Nigeria (and one more market if possible).
- Stretch: DeFindex savings, SDP batch payouts, passkey smart-wallet hardening.

Completion criteria:
- X mainnet users, Y transactions, and $Z real volume in the first month (target something in the Blink/Jumpa range: a few hundred users, low thousands of tx, tens of thousands of dollars volume).
- Anchor live in production.
- Documented non-custodial or minimized-custody key handling and security review.

---

## 6. The real gate: traction, referral, team

The Integration Track explicitly does not fund "new applications without existing user traction." This is where most of the work is. Three levers:

**A. Reuse the Canton traction as proof of execution.** We already have Selkie live on Canton with three working surfaces and real settled payments. That is not zero. The narrative: "We built and shipped this at HackCanton with real users on three surfaces. We are bringing it to Stellar specifically to unlock regulated cash-out and reach emerging-market users. Here is the live product." That reframes the Canton build as de-risking proof, not a competing project.

**B. Build a Stellar testnet MVP and run a small pilot BEFORE the full application.** A working demo beats any deck. Even 30 to 100 pilot users from Martin's X/Telegram audience, the HackCanton network, and Nigerian crypto communities, with real numbers (users, tx count, volume), clears the traction bar. Blink applied with 252 users; Jumpa with 87 testers. We do not need huge numbers, we need real ones.

**C. Get a referral.** In SCF #44, a large majority of awarded projects came through the SCF Referral Program. This is the highest-leverage single move. Plan:
- Sign up at communityfund.stellar.org and complete the verified tier.
- Join the Stellar Developers Discord, show up to SCF office hours.
- Connect with an existing awardee, ideally a Nigerian founder (Blink, Azza, Fiatsend, and similar) or an SDF ecosystem contact, and earn a referral.

Team framing: lead with what we have shipped (live product, three surfaces, on-chain settlement) and the validated need (emerging-market social payments + cash-out, proven by the comps). If we can add a teammate with prior Stellar shipping experience, that further satisfies the "experienced team" half of the bar.

---

## 7. Risks and honesty checklist

- **Privacy:** do not claim confidential balances on a public ledger. Use the honest reframe in section 1.
- **Custody / security:** keep it non-custodial where possible (Privy embedded keys, later passkey smart wallets). Claimable balances are non-custodial by design. If we ever hold keys for unclaimed escrow, minimize it and disclose it. The panel will scrutinize key handling.
- **Unclaimed funds:** define expiry and refund-to-sender behavior for balances that are never claimed.
- **Regulatory:** we are not the money transmitter. The licensed anchor handles the fiat leg. Keep that boundary clean.
- **Pivot decision:** decide explicitly whether Stellar becomes the primary product or a second deployment alongside Canton. The grant application should present one clear primary story.

---

## 8. Do-now checklist

1. Sign up at communityfund.stellar.org, complete the verified tier, join the Stellar Developers Discord.
2. Submit the SCF Interest form (rolling review) describing Selkie-on-Stellar, Integration Track.
3. Start the testnet MVP: Privy social login to embedded wallet, send-by-handle, claimable-balance claim, sponsored fees (Tranche 1 scope).
4. Line up a referral and a small pilot cohort.
5. Draft the Build form: the tranches in section 5, the integration list in section 3, the traction story in section 6, budget around $100k.

---

## Sources
- SCF Handbook, Integration Track (eligibility, panel review, budget tiers, 3-tranche 90-day rule): https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/integration-track
- SCF Handbook, Integration List (qualifying building blocks): https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/integration-track/integration-list
- SCF Build Award overview: https://stellar.gitbook.io/scf-handbook/scf-awards/build-award
- SCF website + interest form: https://communityfund.stellar.org/
- SCF v7 announcement (tracks): https://stellar.org/blog/ecosystem/introducing-scf-v7
- Stellar smart wallets / passkeys (Meridian Pay, Protocol 21 secp256r1): https://stellar.org/blog/ecosystem/building-meridian-pay-smart-wallet-on-stellar and https://developers.stellar.org/docs/build/apps/smart-wallets
- Nigeria SEP-24 anchor (Paychant): https://paychant.com/blog/paychant-integrates-the-stellar-anchor-platform-sep-24
- Stellar anchors / on-off ramps overview: https://stellar.org/use-cases/ramps
