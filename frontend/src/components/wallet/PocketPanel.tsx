"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Check, ExternalLink, Gauge, Loader2 } from "lucide-react";
import { Panel, PanelHead } from "@/components/wallet/Panel";
import { useAuth } from "@/contexts/useAuth";
import { useConfirm, type ConfirmOptions } from "@/contexts/useConfirm";
import { ApiError, api, type Pocket, type PocketInfo, type PreparedPayment } from "@/lib/api";
import { DOLLAR, cleanAmount, money, usd } from "@/lib/format";
import { useNearPay } from "@/lib/near-wallet";
import { DEFAULT_DAILY_LIMIT, isMore, isPositive, leftShare, usdcUnits } from "@/lib/pocket";
import { MASK, useAmountsHidden } from "@/lib/privacy";
import { useLiveRefresh } from "@/lib/useLiveRefresh";

type Action = "top_up" | "withdraw" | "set_cap";

/** One signed change to the pocket: what to ask, what to sign, what to say after. */
interface Step {
  confirm: ConfirmOptions;
  prepare: () => Promise<PreparedPayment>;
  done: string;
}

/**
 * "Send from X": the pocket the X bot pays from.
 *
 * A post can't carry a signature, so a tweet that moves money needs something
 * to move it from. This is that something, kept small on purpose: the bot can
 * only spend what is in here, only up to the daily limit, and only to people
 * already on Selkie. Topping up, withdrawing and changing the limit are signed
 * by the person's own key, through the same prepare, sign and relay as a send.
 *
 * Hidden entirely when the server runs no pocket: a section for a feature that
 * is not there would only be a promise.
 */
export function PocketPanel() {
  const { user, balances, balancesReady, refresh } = useAuth();
  const confirm = useConfirm();
  const nearPay = useNearPay();
  const hidden = useAmountsHidden();

  // undefined while asking the first time; null when there is nothing to show.
  const [info, setInfo] = useState<PocketInfo | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ text: string; explorer?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const found = await api.near.pocket.get();
      setInfo(found.enabled ? found : null);
      setFailed(false);
    } catch (failure) {
      // 404 is a server without the pocket: not an error, just not here.
      if (failure instanceof ApiError && failure.status === 404) setInfo(null);
      else setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The bot spends while this tab sits open: someone tweets from their phone
  // and comes back expecting "left today" to have moved.
  useLiveRefresh(() => void load(), { enabled: Boolean(info) });

  const run = async (step: Step) => {
    if (!(await confirm(step.confirm))) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await nearPay(step.prepare);
      setOpen(null);
      setDone({ text: step.done, explorer: result.explorer });
      void refresh();
      await load();
    } catch (failure) {
      setError(
        failure instanceof ApiError ? failure.message : "That did not go through, so nothing moved. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const show = (action: Action | null) => {
    setOpen(action);
    setError(null);
    setDone(null);
  };

  if (info === null) return null;
  if (info === undefined) {
    if (!failed) return null;
    return (
      <Panel>
        <PanelHead eyebrow="Send from X" title="Your X pocket" />
        <p className="mt-2 text-[15px] leading-relaxed text-pen/60">Your pocket could not be read just now.</p>
        <button onClick={() => void load()} className="btn btn-dim btn-sm mt-4">
          Try again
        </button>
      </Panel>
    );
  }

  const pocket = info.pocket;
  const available = balances.find((balance) => balance.asset === DOLLAR)?.amount ?? "0";
  const figure = (value: string) => (hidden ? MASK : money(value));
  const cap = pocket?.dailyCap ?? DEFAULT_DAILY_LIMIT;

  return (
    <Panel>
      <PanelHead
        eyebrow="Send from X"
        title="Your X pocket"
        blurb={
          <>
            Tweet “@{info.bot} send 2 to @friend” and it goes straight from here, up to your daily limit. Withdraw
            any time. The bot can’t touch the rest of your money.
          </>
        }
      />

      {pocket ? (
        <Figures pocket={pocket} figure={figure} />
      ) : (
        <p className="mt-5 rounded-2xl border border-dashed border-pen/15 p-4 text-[15px] leading-relaxed text-pen/60">
          No pocket yet. Top it up once and your tweets can pay people already on Selkie. The daily limit starts at{" "}
          {usd(DEFAULT_DAILY_LIMIT)} unless you set one.
        </p>
      )}

      {open === null ? (
        <>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <button onClick={() => show("top_up")} className="btn btn-gold btn-sm">
              <ArrowDownToLine size={14} strokeWidth={2.4} /> Top up
            </button>
            {pocket && (
              <>
                <button
                  onClick={() => show("withdraw")}
                  disabled={!isPositive(pocket.balance)}
                  className="btn btn-dim btn-sm"
                >
                  <ArrowUpFromLine size={14} strokeWidth={2.4} /> Withdraw
                </button>
                <button onClick={() => show("set_cap")} className="btn btn-dim btn-sm">
                  <Gauge size={14} strokeWidth={2.4} /> Change daily limit
                </button>
              </>
            )}
          </div>
          {done && (
            <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[14px] text-pen/70">
              <span className="inline-flex items-center gap-1.5">
                <Check size={15} strokeWidth={2.6} className="text-sg" /> {done.text}
              </span>
              {done.explorer && (
                <a
                  href={done.explorer}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 font-mono text-[12.5px] text-sg transition-opacity duration-150 hover:opacity-80"
                >
                  See it on the NEAR explorer <ExternalLink size={13} />
                </a>
              )}
            </p>
          )}
        </>
      ) : (
        <div className="mt-5 border-t border-pen/[0.08] pt-5">
          {open === "top_up" && (
            <TopUpForm
              pocket={pocket}
              available={available}
              availableKnown={balancesReady}
              busy={busy}
              onCancel={() => show(null)}
              onSubmit={(amount, limit) =>
                void run({
                  confirm: {
                    title: `Put ${usd(amount)} in your X pocket?`,
                    confirm: `Top up ${usd(amount)}`,
                    rows: [
                      { label: "Amount", value: usd(amount) },
                      { label: "Daily limit", value: usd(limit || cap) },
                    ],
                    body: "The bot can send from it when you tweet, up to your daily limit. Withdraw it any time.",
                  },
                  prepare: () => api.near.pocket.prepareTopUp({ amount, dailyCap: limit || undefined }),
                  done: `${usd(amount)} is in your X pocket.`,
                })
              }
            />
          )}
          {open === "withdraw" && pocket && (
            <WithdrawForm
              pocket={pocket}
              busy={busy}
              onCancel={() => show(null)}
              onSubmit={(amount) =>
                void run({
                  confirm: {
                    title: amount ? `Withdraw ${usd(amount)}?` : "Withdraw everything?",
                    confirm: amount ? `Withdraw ${usd(amount)}` : `Withdraw ${usd(pocket.balance)}`,
                    rows: [
                      { label: "Amount", value: usd(amount ?? pocket.balance) },
                      ...(user ? [{ label: "To", value: <span className="font-mono text-[13px]">{user.address}</span> }] : []),
                    ],
                    body: "It goes back to your own account.",
                  },
                  prepare: () => api.near.pocket.prepareWithdraw(amount ? { amount } : {}),
                  done: amount ? `${usd(amount)} is back in your account.` : "Your pocket is back in your account.",
                })
              }
            />
          )}
          {open === "set_cap" && pocket && (
            <LimitForm
              current={pocket.dailyCap}
              busy={busy}
              onCancel={() => show(null)}
              onSubmit={(limit) =>
                void run({
                  confirm: {
                    title: `Change your daily limit to ${usd(limit)}?`,
                    confirm: "Change limit",
                    rows: [
                      { label: "Now", value: usd(pocket.dailyCap) },
                      { label: "New", value: usd(limit) },
                    ],
                    body: "The most the bot can send from your pocket in one day.",
                  },
                  prepare: () => api.near.pocket.prepareSetCap({ dailyCap: limit }),
                  done: `Your daily limit is now ${usd(limit)}.`,
                })
              }
            />
          )}
          {error && <p className="mt-4 text-[14px] font-semibold text-[#f28b9b]">{error}</p>}
        </div>
      )}
    </Panel>
  );
}

/** The balance, and how much of today's limit is left, as a figure and a gauge. */
function Figures({ pocket, figure }: { pocket: Pocket; figure: (value: string) => string }) {
  const share = leftShare(pocket.leftToday, pocket.dailyCap);
  const spent = isPositive(pocket.spentToday);
  return (
    <div className="mt-5">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
        <div className="col-span-2 sm:col-span-1">
          <dt className="label">In your pocket</dt>
          <dd className="mt-1.5 font-mono text-[2rem] font-medium leading-none tracking-[-0.03em] tabular-nums">
            {figure(pocket.balance)}
            <span className="ml-1.5 text-[14px] tracking-normal text-pen/45">USDC</span>
          </dd>
        </div>
        <div>
          <dt className="label">Left today</dt>
          <dd className="mt-1 font-mono text-[15px] tabular-nums">{figure(pocket.leftToday)}</dd>
        </div>
        <div>
          <dt className="label">Daily limit</dt>
          <dd className="mt-1 font-mono text-[15px] tabular-nums">{figure(pocket.dailyCap)}</dd>
        </div>
      </dl>
      <div
        className="mt-4 h-1.5 overflow-hidden rounded-full bg-pen/[0.08]"
        role="img"
        aria-label={`${money(pocket.leftToday)} of ${money(pocket.dailyCap)} USDC left today`}
      >
        <i
          className="block h-full origin-left rounded-full bg-sg transition-transform duration-500 [transition-timing-function:var(--ease)]"
          style={{ transform: `scaleX(${share / 100})` }}
        />
      </div>
      <p className="mt-2.5 text-[13px] text-pen/50">
        {spent ? (
          <>
            <span className="font-mono text-[#f28b9b]">{figure(pocket.spentToday)} USDC</span> sent from X today.
          </>
        ) : (
          "Nothing sent from X today."
        )}{" "}
        The limit resets at 00:00 UTC.
      </p>
    </div>
  );
}

/** An amount in USDC. Named, not signed, like every amount in the wallet. */
function AmountField({
  id,
  value,
  onChange,
  placeholder = "0.00",
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="relative mt-2">
      <input
        id={id}
        className="field h-[2.875rem] pr-16 font-mono text-[16px] tabular-nums"
        placeholder={placeholder}
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(cleanAmount(event.target.value))}
      />
      <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-[11.5px] text-pen/45">
        USDC
      </span>
    </div>
  );
}

function Hint({ children, bad }: { children: ReactNode; bad?: boolean }) {
  return <p className={`mt-2 text-[13px] ${bad ? "font-semibold text-[#f28b9b]" : "text-pen/50"}`}>{children}</p>;
}

function FormButtons({ label, ready, busy, onCancel }: { label: string; ready: boolean; busy: boolean; onCancel: () => void }) {
  return (
    <div className="mt-5 flex flex-wrap gap-2.5">
      <button type="submit" disabled={!ready || busy} className="btn btn-gold btn-sm">
        {busy && <Loader2 size={14} className="animate-spin" />}
        {busy ? "Signing" : label}
      </button>
      <button type="button" onClick={onCancel} disabled={busy} className="btn btn-dim btn-sm">
        Cancel
      </button>
    </div>
  );
}

function TopUpForm({
  pocket,
  available,
  availableKnown,
  busy,
  onCancel,
  onSubmit,
}: {
  pocket: Pocket | null;
  available: string;
  availableKnown: boolean;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (amount: string, limit: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [limit, setLimit] = useState("");
  const tooMuch = availableKnown && isMore(amount, available);
  const badLimit = limit !== "" && !isPositive(limit);
  const ready = isPositive(amount) && !tooMuch && !badLimit;
  const current = pocket?.dailyCap ?? DEFAULT_DAILY_LIMIT;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready && !busy) onSubmit(amount, limit);
  };

  return (
    <form onSubmit={submit}>
      <label className="label block" htmlFor="pocket-amount">
        How much to put in
      </label>
      <AmountField id="pocket-amount" value={amount} onChange={setAmount} autoFocus />
      <Hint bad={tooMuch}>
        {tooMuch ? `Your account holds ${usd(available)}.` : `${usd(available)} in your account`}
      </Hint>

      <label className="label mt-4 block" htmlFor="pocket-limit">
        Daily limit <span className="font-medium text-pen/40">(optional)</span>
      </label>
      <AmountField id="pocket-limit" value={limit} onChange={setLimit} placeholder={money(current)} />
      <Hint bad={badLimit}>
        {badLimit
          ? "A daily limit has to be more than zero."
          : pocket && limit !== ""
            ? `Now ${usd(current)} a day.`
            : pocket
              ? `Leave it empty to keep ${usd(current)} a day.`
            : `Leave it empty for ${usd(current)} a day.`}
      </Hint>

      <FormButtons label={ready ? `Top up ${usd(amount)}` : "Top up"} ready={ready} busy={busy} onCancel={onCancel} />
    </form>
  );
}

function WithdrawForm({
  pocket,
  busy,
  onCancel,
  onSubmit,
}: {
  pocket: Pocket;
  busy: boolean;
  onCancel: () => void;
  /** Undefined means everything. */
  onSubmit: (amount: string | undefined) => void;
}) {
  const [all, setAll] = useState(true);
  const [amount, setAmount] = useState("");
  const tooMuch = !all && isMore(amount, pocket.balance);
  const ready = all ? isPositive(pocket.balance) : isPositive(amount) && !tooMuch;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready && !busy) onSubmit(all ? undefined : amount);
  };

  return (
    <form onSubmit={submit}>
      <div className="seg" role="group" aria-label="How much to withdraw">
        <button type="button" onClick={() => setAll(true)} className={`seg-btn ${all ? "seg-on" : ""}`} aria-pressed={all}>
          Everything
        </button>
        <button type="button" onClick={() => setAll(false)} className={`seg-btn ${all ? "" : "seg-on"}`} aria-pressed={!all}>
          Some of it
        </button>
      </div>

      {all ? (
        <Hint>{usd(pocket.balance)} goes back to your account.</Hint>
      ) : (
        <>
          <label className="label mt-4 block" htmlFor="pocket-withdraw">
            How much
          </label>
          <AmountField id="pocket-withdraw" value={amount} onChange={setAmount} autoFocus />
          <Hint bad={tooMuch}>
            {tooMuch ? `Your pocket holds ${usd(pocket.balance)}.` : `${usd(pocket.balance)} in your pocket`}
          </Hint>
        </>
      )}

      <FormButtons
        label={all ? `Withdraw ${usd(pocket.balance)}` : ready ? `Withdraw ${usd(amount)}` : "Withdraw"}
        ready={ready}
        busy={busy}
        onCancel={onCancel}
      />
    </form>
  );
}

function LimitForm({
  current,
  busy,
  onCancel,
  onSubmit,
}: {
  current: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (limit: string) => void;
}) {
  const [limit, setLimit] = useState("");
  const same = limit !== "" && usdcUnits(limit) === usdcUnits(current);
  const ready = isPositive(limit) && !same;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready && !busy) onSubmit(limit);
  };

  return (
    <form onSubmit={submit}>
      <label className="label block" htmlFor="pocket-cap">
        New daily limit
      </label>
      <AmountField id="pocket-cap" value={limit} onChange={setLimit} placeholder={money(current)} autoFocus />
      <Hint>
        {same
          ? "That is already your limit."
          : `The most the bot can send from your pocket in one day. Now ${usd(current)}.`}
      </Hint>
      <FormButtons label="Change limit" ready={ready} busy={busy} onCancel={onCancel} />
    </form>
  );
}
