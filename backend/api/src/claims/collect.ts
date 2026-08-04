import type { ActivityStore } from "../activity/store";
import type { ClaimOutcome, IdentityService } from "../identity/service";
import type { User } from "../identity/types";

/**
 * Releasing money that was waiting, and writing down both halves of it.
 *
 * Shared by the two things that can trigger it — somebody signing in, and the
 * watcher noticing a deposit — because there is exactly one right answer to
 * "what should the feed say", and having it in two places is how the second one
 * ends up recording nothing. Which is what used to happen.
 */
export interface ClaimDeps {
  identity: IdentityService;
  activity: ActivityStore;
}

/**
 * Money that was waiting and just landed deserves a line in the feed, and the
 * person who sent it deserves to stop being told it is still waiting.
 */
export async function recordClaims(
  deps: ClaimDeps,
  userId: string,
  claimed: ClaimOutcome[],
): Promise<void> {
  for (const outcome of claimed) {
    for (const amount of outcome.amounts) {
      await deps.activity.record(userId, {
        kind: "claim",
        chain: "stellar",
        amount,
        status: "confirmed",
        ref: outcome.ref,
      });
    }
    // The other half of the story. Without this a sender's feed says "Waiting"
    // forever, long after the money arrived.
    for (const paymentId of outcome.paymentIds) {
      await deps.activity.settleByClaimRef(paymentId, "confirmed", outcome.ref);
    }
  }
}

/** Release whatever is waiting for this person, and record it. */
export async function collectFor(deps: ClaimDeps, user: User): Promise<ClaimOutcome[]> {
  const claimed = await deps.identity.claimWaitingMoney(user);
  await recordClaims(deps, user.id, claimed);
  return claimed;
}
