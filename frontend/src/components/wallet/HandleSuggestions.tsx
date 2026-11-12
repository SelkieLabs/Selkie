"use client";

import { Check } from "lucide-react";
import { Avatar } from "@/components/Layout";
import type { HandleSuggestion } from "@/lib/api";

/**
 * The list under the Send box: people already on Selkie whose handle matches.
 * Picking one fills the handle; nothing is sent until the confirm step.
 * `onMouseDown` keeps the input focused, so the tap lands before it blurs.
 */
export function HandleSuggestions({
  id,
  matches,
  active,
  onPick,
}: {
  id: string;
  matches: HandleSuggestion[];
  active: number;
  onPick: (match: HandleSuggestion) => void;
}) {
  return (
    <ul
      id={id}
      role="listbox"
      aria-label="People on Selkie"
      className="fade-in absolute inset-x-0 z-30 mt-2 max-h-80 overflow-y-auto rounded-2xl bg-tide-2 p-1.5 shadow-[inset_0_0_0_1px_rgba(233,241,236,0.1),0_24px_48px_-12px_rgba(0,0,0,0.6)]"
    >
      <li className="px-3 pb-1 pt-1.5 text-[12.5px] font-medium text-pen/45">On Selkie</li>
      {matches.map((match, i) => (
        <li key={match.username} id={`${id}-${i}`} role="option" aria-selected={i === active}>
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(match)}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-150 hover:bg-pen/[0.05] ${
              i === active ? "bg-pen/[0.07]" : ""
            }`}
          >
            <Avatar name={`@${match.username}`} src={match.avatarUrl} size={34} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold text-pen">
                {match.displayName || `@${match.username}`}
              </span>
              <span className="block truncate font-mono text-[12px] text-pen/50">
                {match.displayName
                  ? `@${match.username}${match.nearAccount ? ` · ${match.nearAccount}` : ""}`
                  : (match.nearAccount ?? "On Selkie")}
              </span>
            </span>
            {i === active && <Check size={15} className="shrink-0 text-sg" aria-hidden="true" />}
          </button>
        </li>
      ))}
    </ul>
  );
}
