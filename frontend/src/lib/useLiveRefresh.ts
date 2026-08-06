"use client";

import { useEffect, useRef } from "react";

/**
 * Keep a screen up to date with things that happened somewhere else.
 *
 * Selkie has more than one way in. Money can arrive because a friend paid you,
 * or because you posted at @SelkiePay from your phone while this tab sat open
 * on your laptop. A page that loads once and never looks again shows a wallet
 * that is quietly wrong, and the person looking at it has no way to know: an
 * empty history is indistinguishable from a history that failed to arrive.
 *
 * Two triggers, because they cover different halves of the problem.
 *
 * Coming back to the tab refreshes immediately. This is the one that matters
 * most, and it is nearly free: switching to another app and back is exactly
 * what somebody does when they go and post from X, so the moment they return is
 * the moment they expect to see it.
 *
 * A timer covers the rest, for a tab left open and watched. It runs only while
 * the page is actually visible, because a background tab polling forever is a
 * request every few seconds for nobody, on somebody's phone battery.
 */
export function useLiveRefresh(refresh: () => void, { everyMs = 12_000, enabled = true } = {}): void {
  // Held in a ref so a caller does not have to memoize its callback to avoid
  // tearing down the timer on every render.
  const latest = useRef(refresh);
  latest.current = refresh;

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setInterval> | undefined;

    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };

    const start = () => {
      stop();
      timer = setInterval(() => latest.current(), everyMs);
    };

    const onVisible = () => {
      if (document.visibilityState === "hidden") return stop();
      // Refresh first, then resume the timer, so the wait starts from now
      // rather than delivering a second call a moment later.
      latest.current();
      start();
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisible);
    // Focus as well as visibility: moving between windows on a desktop does not
    // always change visibility, and that is the same person coming back.
    window.addEventListener("focus", onVisible);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [everyMs, enabled]);
}
