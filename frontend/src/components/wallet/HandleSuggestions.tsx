"use client";

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
      className="fade-in absolute inset-x-0 z-30 mt-2 max-h-80 overflow-y-auto rounded-2xl border-2 border-pen bg-card-bright p-1.5 shadow-[0.18rem_0.24rem_0_rgba(3,9,15,0.55)]"
    >
      <li className="px-3 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-pen/45">On Selkie</li>
      {matches.map((match, i) => (
        <li key={match.username} id={`${id}-${i}`} role="option" aria-selected={i === active}>
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(match)}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-pen/[0.06] ${
              i === active ? "bg-gold/25" : ""
            }`}
          >
            <Avatar name={`@${match.username}`} src={match.avatarUrl} size={34} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-bold text-pen/90">
                {match.displayName || `@${match.username}`}
              </span>
              <span className="block truncate text-[13px] font-semibold text-pen/50">
                {match.displayName
                  ? `@${match.username}${match.nearAccount ? ` · ${match.nearAccount}` : ""}`
                  : (match.nearAccount ?? "On Selkie")}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
