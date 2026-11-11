"use client";

import { PlatformLogo } from "@/components/Mark";
import { PLATFORMS, PLATFORM_LABEL, type Platform } from "@/lib/platform";

/**
 * Which platform a handle belongs to.
 *
 * Shown as a choice rather than inferred, because `@amaka` on X and `@amaka` on
 * Telegram are two different people and there is no way to tell them apart from
 * the text. Getting this wrong sends money to a stranger, so it is never a
 * guess.
 */
export function PlatformToggle({
  value,
  onChange,
  idPrefix,
}: {
  value: Platform;
  onChange: (platform: Platform) => void;
  /** Distinguishes the radio group when two of these share a page. */
  idPrefix: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Which platform"
      className="mt-2 flex flex-wrap gap-2"
    >
      {PLATFORMS.map((platform) => (
        <button
          key={platform}
          id={`${idPrefix}-${platform}`}
          type="button"
          role="radio"
          aria-checked={platform === value}
          onClick={() => onChange(platform)}
          className={`chip h-9 px-3.5 text-[13px] ${platform === value ? "chip-on" : ""}`}
        >
          <PlatformLogo platform={platform} size={13} />
          {PLATFORM_LABEL[platform]}
        </button>
      ))}
    </div>
  );
}
