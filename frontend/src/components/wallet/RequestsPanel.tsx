"use client";

import { useState } from "react";
import { Check, HandCoins, Loader2, X } from "lucide-react";
import { Avatar } from "@/components/Layout";
import { Panel, PanelHead } from "@/components/wallet/Panel";
import { useToast } from "@/contexts/ToastContext";
import { ApiError, api, type MoneyRequest } from "@/lib/api";
import { DOLLAR, cleanAmount, money, timeAgo, usd } from "@/lib/format";

/** How a settled request reads once nobody has to do anything about it. */
const SETTLED: Record<string, string> = {
  paid: "Paid",
  declined: "Turned down",
  cancelled: "Withdrawn",
};

function amountOf(request: MoneyRequest): string {
  return request.amount.asset === DOLLAR
    ? usd(request.amount.amount)
    : `${money(request.amount.amount)} ${request.amount.asset}`;
}

function Row({
  request,
  who,
  children,
}: {
  request: MoneyRequest;
  who: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3 border-t-2 border-pen/[0.07] px-5 py-4 first:border-t-0">
      <Avatar name={who} size={38} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-bold tracking-tight">{who}</p>
        <p className="mt-0.5 truncate text-[13px] font-medium text-pen/50">
          {request.note ? `${request.note} · ` : ""}
          {timeAgo(request.createdAt)}
        </p>
      </div>
      <span className="shrink-0 font-display text-[17px] font-bold tabular-nums">
        {amountOf(request)}
      </span>
      {children && <div className="flex w-full shrink-0 gap-2 sm:w-auto">{children}</div>}
    </div>
  );
}

/**
 * Asking for money, and answering people who asked you.
 *
 * A request moves nothing on its own. Only the person it was addressed to can
 * turn it into a payment, and they do it here, with the amount in front of them
 * and one tap to say no.
 */
export function RequestsPanel({
  incoming,
  outgoing,
  loading,
  canAsk,
  onChanged,
}: {
  incoming: MoneyRequest[];
  outgoing: MoneyRequest[];
  loading: boolean;
  /** False when they have not linked a handle yet, so nobody could answer them. */
  canAsk: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [from, setFrom] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cleanFrom = from.trim().replace(/^@+/, "").toLowerCase();
  const canSubmit = canAsk && cleanFrom.length > 0 && Number(amount) > 0;

  const waiting = incoming.filter((request) => request.status === "pending");
  const answered = incoming.filter((request) => request.status !== "pending");

  const ask = async () => {
    setAsking(true);
    setError(null);
    try {
      await api.ask({ from: cleanFrom, amount, asset: DOLLAR, note: note.trim() || undefined });
      toast("success", `Asked @${cleanFrom} for ${usd(amount)}.`);
      setFrom("");
      setAmount("");
      setNote("");
      onChanged();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "We could not send that.";
      setError(message);
      toast("error", message);
    } finally {
      setAsking(false);
    }
  };

  /** Every action on a request is the same shape: do it, say so, reload. */
  const act = async (
    id: string,
    run: () => Promise<unknown>,
    success: string,
    fallback: string,
  ) => {
    setBusyId(id);
    try {
      await run();
      toast("success", success);
      onChanged();
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : fallback);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHead
          eyebrow="Requests"
          title="Ask someone for money"
          blurb="Nothing moves until they say yes. They can pay it in one tap."
        />

        {!canAsk && (
          <p className="mt-5 rounded-xl bg-pen/[0.05] p-3.5 text-[14px] leading-relaxed text-pen/70">
            Add your X handle first, so whoever you ask knows who is asking.
          </p>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-[1fr_10rem]">
          <div>
            <label className="label block" htmlFor="ask-handle">
              Their X handle
            </label>
            <div className="relative mt-2">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[15px] font-bold text-pen/40">
                @
              </span>
              <input
                id="ask-handle"
                className="field pl-9"
                placeholder="amaka"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                disabled={!canAsk}
                value={from.replace(/^@+/, "")}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="label block" htmlFor="ask-amount">
              How much
            </label>
            <div className="relative mt-2">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[15px] font-bold text-pen/40">
                $
              </span>
              <input
                id="ask-amount"
                className="field pl-8 font-display font-bold"
                placeholder="0.00"
                inputMode="decimal"
                disabled={!canAsk}
                value={amount}
                onChange={(e) => setAmount(cleanAmount(e.target.value))}
              />
            </div>
          </div>
        </div>

        <label className="label mt-4 block" htmlFor="ask-note">
          What is it for <span className="font-medium text-pen/40">(optional)</span>
        </label>
        <input
          id="ask-note"
          className="field mt-2"
          placeholder="your half of dinner"
          maxLength={80}
          disabled={!canAsk}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && canSubmit && !asking && void ask()}
        />

        {error && <p className="mt-4 text-sm font-semibold text-[#a11d34]">{error}</p>}

        <button
          onClick={() => void ask()}
          disabled={!canSubmit || asking}
          className="btn btn-gold mt-6 w-full"
        >
          {asking ? <Loader2 size={16} className="animate-spin" /> : null}
          {asking ? "Asking" : amount ? `Ask for ${usd(amount)}` : "Ask"}
        </button>
      </Panel>

      {loading ? (
        <Panel className="!p-0">
          {[0, 1].map((row) => (
            <div key={row} className="flex items-center gap-3.5 border-t-2 border-pen/[0.07] px-5 py-4 first:border-t-0">
              <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-pen/[0.08]" />
              <div className="flex-1">
                <span className="block h-3.5 w-28 animate-pulse rounded bg-pen/[0.08]" />
                <span className="mt-2 block h-3 w-20 animate-pulse rounded bg-pen/[0.06]" />
              </div>
              <span className="h-4 w-14 animate-pulse rounded bg-pen/[0.08]" />
            </div>
          ))}
        </Panel>
      ) : (
        <>
          <section>
            <h2 className="font-display text-lg font-bold tracking-tight text-ivory">
              Waiting on you
            </h2>
            {waiting.length === 0 ? (
              <div className="chunk mt-3 p-7 text-center">
                <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-gold/15 text-gold-ink">
                  <HandCoins size={20} strokeWidth={2.2} />
                </span>
                <p className="mt-3.5 text-[15px] leading-relaxed text-pen/60">
                  Nobody is waiting on you. When someone asks you for money, it lands here.
                </p>
              </div>
            ) : (
              <div className="chunk mt-3 overflow-hidden">
                {waiting.map((request) => (
                  <Row
                    key={request.id}
                    request={request}
                    who={`@${request.fromHandle.username}`}
                  >
                    <button
                      onClick={() =>
                        void act(
                          request.id,
                          () => api.declineRequest(request.id),
                          "Turned down.",
                          "We could not turn that down.",
                        )
                      }
                      disabled={busyId === request.id}
                      className="btn btn-dim btn-sm flex-1 sm:flex-none"
                    >
                      <X size={15} strokeWidth={2.6} /> No
                    </button>
                    <button
                      onClick={() =>
                        void act(
                          request.id,
                          () => api.payRequest(request.id),
                          `Paid @${request.fromHandle.username}.`,
                          "That payment did not go through.",
                        )
                      }
                      disabled={busyId === request.id}
                      className="btn btn-gold btn-sm flex-1 sm:flex-none"
                    >
                      {busyId === request.id ? (
                        <Loader2 size={15} className="animate-spin" />
                      ) : (
                        <Check size={15} strokeWidth={2.6} />
                      )}
                      Pay
                    </button>
                  </Row>
                ))}
              </div>
            )}
          </section>

          {(outgoing.length > 0 || answered.length > 0) && (
            <section>
              <h2 className="font-display text-lg font-bold tracking-tight text-ivory">
                What you asked for
              </h2>
              <div className="chunk mt-3 overflow-hidden">
                {outgoing.map((request) => (
                  <Row key={request.id} request={request} who={`@${request.toHandle.username}`}>
                    {request.status === "pending" ? (
                      <button
                        onClick={() =>
                          void act(
                            request.id,
                            () => api.cancelRequest(request.id),
                            "Withdrawn.",
                            "We could not withdraw that.",
                          )
                        }
                        disabled={busyId === request.id}
                        className="btn btn-dim btn-sm flex-1 sm:flex-none"
                      >
                        Withdraw
                      </button>
                    ) : (
                      <span className="rounded-full bg-pen/[0.07] px-3 py-1 text-[12px] font-bold text-pen/55">
                        {SETTLED[request.status]}
                      </span>
                    )}
                  </Row>
                ))}
                {answered.map((request) => (
                  <Row key={request.id} request={request} who={`@${request.fromHandle.username}`}>
                    <span className="rounded-full bg-pen/[0.07] px-3 py-1 text-[12px] font-bold text-pen/55">
                      {SETTLED[request.status]}
                    </span>
                  </Row>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
