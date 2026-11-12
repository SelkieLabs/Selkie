"use client";

import { ArrowRight } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { useAuth } from "@/contexts/useAuth";
import { NEAR_NETWORK } from "@/lib/chain";
import { readPayLink, savePayLink } from "@/lib/pay-link";
import { previewAccount } from "./hooks";

/**
 * The handle box: the whole product in one field. Type who you want to pay,
 * press Send, sign in with X, and Send opens with them filled in (the same
 * hand-off the X bot's pay links use). Nothing moves until the person checks
 * the confirm screen and signs.
 */
export function HandleForm({
  onHandle,
  example = "amaka",
}: {
  /** Called as the handle changes, so the page can echo it (the floating pass does). */
  onHandle?: (handle: string) => void;
  example?: string;
}) {
  const { signIn } = useAuth();
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const id = useId();

  const handle = value.trim().replace(/^@+/, "");
  const account = previewAccount(handle || example, NEAR_NETWORK);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!handle) {
      signIn();
      return;
    }
    const link = readPayLink("pay", handle, new URLSearchParams());
    if (!link) {
      setError(true);
      return;
    }
    savePayLink(link);
    signIn();
  };

  return (
    <form onSubmit={submit} noValidate>
      <label htmlFor={id} className="sr-only">
        Their X handle
      </label>
      <div className="td-handle">
        <span className="at" aria-hidden="true">
          @
        </span>
        <input
          id={id}
          value={value}
          onChange={(e) => {
            const next = e.target.value.replace(/\s/g, "").slice(0, 16);
            setValue(next);
            setError(false);
            onHandle?.(next.replace(/^@+/, ""));
          }}
          placeholder="their handle"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          inputMode="text"
          aria-describedby={`${id}-hint`}
        />
        <button type="submit" className="td-btn td-btn-sg">
          <span>Send</span> <ArrowRight size={17} strokeWidth={2.4} />
        </button>
      </div>
      <p id={`${id}-hint`} className={`td-preview${error || (handle && !account) ? " bad" : ""}`} aria-live="polite">
        {error || (handle && !account) ? (
          <>
            <span>X handles are letters, numbers and _ only.</span>
          </>
        ) : handle ? (
          <>
            <span>If @{handle} is new here, it lands in</span>
            <b>{account}</b>
          </>
        ) : (
          <>
            <span>Try @{example}: it lands in</span>
            <b>{account}</b>
          </>
        )}
      </p>
    </form>
  );
}
