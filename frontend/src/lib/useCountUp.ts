"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Long enough that the slow part at the end is a moment rather than a frame.
 * Most of the distance is covered in the first fifth of it, so this reads as a
 * quick count with a settle on the end, not as a slow count.
 */
const DURATION_MS = 1100;

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(listener: () => void): () => void {
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

/**
 * Whether this person has asked their system to keep motion down.
 *
 * The stylesheet already parks every CSS animation under the same query, but a
 * number counted in JavaScript is not an animation as far as CSS is concerned,
 * so it would sail straight past that rule and keep moving. Asked in JS, it
 * stops too.
 *
 * The server has no way to know the answer, so it guesses "motion is fine" and
 * the client corrects it on hydration. Guessing the other way would mean
 * everyone briefly gets no animation, which is the more common case being
 * punished for the rarer one.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

/**
 * Count a number up to where it is going instead of snapping to it.
 *
 * A balance that appears fully formed reads as a fact the page already had. One
 * that counts reads as an answer that just arrived, which is what it is: the
 * number lands when the balance call comes back. The motion is doing honest
 * work rather than decorating.
 *
 * Eased out, not linear. A linear count stops dead on its last frame and looks
 * like it was cut off; easing out spends most of its time near the real figure
 * and settles onto it, so the eye reads the final number for most of the
 * animation and the movement is what falls away.
 *
 * Counts from wherever it currently is, not from zero every time. On first
 * paint that is zero, which is the effect people mean by a counting balance.
 * Afterwards a refresh that moves the balance counts the difference from the
 * number already on screen, and a refresh that changes nothing does not animate
 * at all: re-running the whole count every twelve seconds on an unchanged
 * balance would turn a nice touch into a twitch.
 */
export function useCountUp(
  target: number,
  { enabled = true, durationMs = DURATION_MS } = {},
): number {
  const still = usePrefersReducedMotion();
  const animate = enabled && !still && Number.isFinite(target);

  const [shown, setShown] = useState(() => (animate ? 0 : target));
  // What the next count starts from. Held in a ref rather than read back out of
  // state, because a frame needs the value as of that frame and state read
  // inside the loop would be one render behind.
  const from = useRef(animate ? 0 : target);

  useEffect(() => {
    if (!animate) {
      from.current = target;
      setShown(target);
      return;
    }
    const start = from.current;
    if (start === target) return;

    let frame = 0;
    const began = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - began) / durationMs);
      // Quartic ease out: steep enough that the number arrives in the right
      // neighbourhood almost at once, then visibly gives up speed and steps
      // through the last of it. A higher power than this crosses into looking
      // stalled, because once only the final cents are still changing there is
      // nothing left on screen to read as movement.
      const eased = 1 - (1 - progress) ** 4;
      const value = progress === 1 ? target : start + (target - start) * eased;
      from.current = value;
      setShown(value);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, animate, durationMs]);

  return shown;
}
