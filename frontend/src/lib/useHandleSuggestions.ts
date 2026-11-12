"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
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

/**
 * Everything a handle box needs to offer suggestions: which to show, which
 * one the arrow keys are on, and the input props (focus, keys, ARIA). Shared
 * by Send, Pay many and Requests so they behave the same.
 *
 * `onKeyDown` returns true when it used the key (arrows, Escape, Enter on a
 * highlighted name), so the box's own Enter handling only runs otherwise.
 */
export function useHandleSuggestBox({
  id,
  text,
  enabled,
  exclude = [],
  onPick,
}: {
  id: string;
  text: string;
  enabled: boolean;
  exclude?: string[];
  onPick: (username: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const found = useHandleSuggestions(text, enabled);
  // A single exact match means the handle is already typed in full.
  const suggestions = found.filter(
    (match) => !exclude.includes(match.username) && !(found.length === 1 && match.username === text),
  );
  const show = focused && suggestions.length > 0;

  const pick = (username: string) => {
    setActive(-1);
    onPick(username);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): boolean => {
    if (!show) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + suggestions.length) % suggestions.length);
      return true;
    }
    if (event.key === "Escape") {
      setFocused(false);
      return true;
    }
    const chosen = suggestions[active];
    if (event.key === "Enter" && chosen) {
      event.preventDefault();
      pick(chosen.username);
      return true;
    }
    return false;
  };

  return {
    show,
    /** Close the list, e.g. after a pick that moves focus elsewhere. */
    close: () => setFocused(false),
    /** Call from onChange: typing reopens the list and clears the highlight. */
    typed: () => {
      setActive(-1);
      setFocused(true);
    },
    onKeyDown,
    inputProps: {
      role: "combobox" as const,
      "aria-expanded": show,
      "aria-controls": id,
      "aria-autocomplete": "list" as const,
      "aria-activedescendant": show && active >= 0 ? `${id}-${active}` : undefined,
      onFocus: () => setFocused(true),
      onBlur: () => setFocused(false),
    },
    listProps: { id, matches: suggestions, active, onPick: (match: HandleSuggestion) => pick(match.username) },
  };
}
