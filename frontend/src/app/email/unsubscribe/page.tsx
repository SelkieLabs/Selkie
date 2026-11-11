"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, MailX } from "lucide-react";
import { Header, Shell } from "@/components/Layout";
import { ApiError, api } from "@/lib/api";

/**
 * Where "Stop these emails" in a Selkie email lands.
 *
 * It asks before stopping anything. Mail scanners and link previews open
 * every link in an email, and if opening this one were enough, they would
 * unsubscribe people who never clicked it. No sign-in: the signed link is
 * the proof it came from that person's inbox.
 */
export default function UnsubscribePage() {
  return (
    <>
      <Header />
      <main className="pb-24 pt-16">
        <Shell>
          <Suspense fallback={<Loader2 className="mx-auto animate-spin text-pen/40" />}>
            <Unsubscribe />
          </Suspense>
        </Shell>
      </main>
    </>
  );
}

function Unsubscribe() {
  const params = useSearchParams();
  const userId = params.get("u") ?? "";
  const token = params.get("t") ?? "";
  const [state, setState] = useState<"asking" | "working" | "done" | "failed">("asking");
  const [error, setError] = useState("");

  const stop = async () => {
    setState("working");
    try {
      await api.email.unsubscribe(userId, token);
      setState("done");
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "That did not work. Try again in a moment.");
      setState("failed");
    }
  };

  return (
    <section className="chunk p-7 sm:p-9">
      <MailX size={28} strokeWidth={2.2} className="text-gold-ink" />
      {state === "done" ? (
        <>
          <h1 className="mt-4 font-display text-[26px] font-bold tracking-tight">Emails stopped</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-pen/65">
            Selkie will not email you when money comes in. Your money is not affected. You can turn emails back on in
            Settings whenever you like.
          </p>
          <Link href="/wallet/home" className="btn btn-dark btn-sm mt-6">
            Open your wallet
          </Link>
        </>
      ) : (
        <>
          <h1 className="mt-4 font-display text-[26px] font-bold tracking-tight">Stop Selkie emails?</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-pen/65">
            You will stop getting an email when money comes in. Nothing else changes.
          </p>
          <button
            onClick={() => void stop()}
            disabled={state === "working" || !userId || !token}
            className="btn btn-dark btn-sm mt-6"
          >
            {state === "working" && <Loader2 size={14} className="animate-spin" />} Stop emails
          </button>
          {state === "failed" && <p className="mt-3 text-[14px] font-medium text-[#b91c34]">{error}</p>}
          {(!userId || !token) && (
            <p className="mt-3 text-[14px] font-medium text-[#b91c34]">This link is incomplete. Use the one in the email.</p>
          )}
        </>
      )}
    </section>
  );
}
