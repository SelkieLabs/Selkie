"use client";

import { useEffect, useState } from "react";
import { api, type HandleSuggestion } from "@/lib/api";

const MIN_LETTERS = 3;
const WAIT_MS = 180;

/**
 * Selkie people whose X handle matches what is being typed, from the third
 * letter. Waits for a short pause in typing so a fast typist sends one request,
 * not one per key, and keeps every answer so backspacing costs nothing. While
 * a new answer is on its way, the last one is narrowed down in place, so the
 * list never blinks empty. A failed lookup shows nothing: typing the full
 * handle still works.
 */
export function useHandleSuggestions(text: string, enabled: boolean): HandleSuggestion[] {
  const [known, setKnown] = useState<Record<string, HandleSuggestion[]>>({});
  const wanted = enabled && text.length >= MIN_LETTERS ? text : "";
  const have = wanted ? known[wanted] : undefined;

  useEffect(() => {
    if (!wanted || have) return;
    const timer = setTimeout(() => {
      api
        .searchHandles(wanted)
        .then(({ matches }) => setKnown((all) => ({ ...all, [wanted]: matches })))
        .catch(() => undefined);
    }, WAIT_MS);
    return () => clearTimeout(timer);
  }, [wanted, have]);

  if (!wanted) return [];
  if (have) return have;
  // Nearest earlier answer for a shorter version of this text, narrowed down.
  for (let end = wanted.length - 1; end >= MIN_LETTERS; end--) {
    const earlier = known[wanted.slice(0, end)];
    if (earlier) {
      return earlier.filter(
        (m) => m.username.includes(wanted) || (m.displayName ?? "").toLowerCase().includes(wanted),
      );
    }
  }
  return [];
}
