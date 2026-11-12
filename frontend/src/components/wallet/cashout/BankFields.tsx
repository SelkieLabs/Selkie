"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, Building2, Check, ChevronDown, ExternalLink, Eye, Loader2, Smartphone } from "lucide-react";
import { money } from "@/lib/format";
import {
  BANK_CURRENCIES,
  accountLength,
  bankStages,
  currencyOf,
  fiat,
  previewLabel,
  useBankStatus,
  type BankCurrency,
  type useAccountName,
  type useBankQuote,
  type useBanks,
} from "@/lib/bank";
import { Fresh, Note, Row, Timeline } from "./bits";
import type { BankDetails } from "./model";

type Banks = ReturnType<typeof useBanks>;
type NameCheck = ReturnType<typeof useAccountName>;
type Quote = ReturnType<typeof useBankQuote>;

/**
 * The bank details on NEAR, where Paycrest pays out: the currency, a bank
 * from Paycrest's own list, and the account number, whose holder's name is
 * looked up as it is typed so a wrong digit shows up as a wrong name before
 * anything moves.
 */
export function PaycrestBankFields({
  bank,
  onBank,
  banks,
  name,
  quote,
}: {
  bank: BankDetails;
  onBank: (patch: Partial<BankDetails>) => void;
  banks: Banks;
  name: NameCheck;
  quote: Quote;
}) {
  const currency = currencyOf(bank.currency);
  const list = banks.institutions;
  const picked = list?.find((entry) => entry.code === bank.institution) ?? null;
  const mobile = picked?.type === "mobile_money";

  return (
    <>
      <span className="co-label">Paid in</span>
      <CurrencyChips
        value={bank.currency}
        onPick={(code) => {
          if (code !== bank.currency) onBank({ currency: code, institution: "", bank: "", accountName: "" });
        }}
      />
      <p key={currency.code} className="co-hint co-swap-in mt-2">
        {currency.name}, to a bank or mobile-money account in {currency.country}.
      </p>

      <label className="co-label mt-5" htmlFor="cashout-institution">
        {mobile ? <Smartphone size={15} /> : <Building2 size={15} />}
        Bank
      </label>
      {banks.error && !list ? (
        <div className="mt-2 grid justify-items-start gap-2">
          <p className="co-error">{banks.error}</p>
          <button type="button" className="co-link" onClick={banks.reload}>
            Try again
          </button>
        </div>
      ) : (
        <div className="relative mt-2">
          <select
            id="cashout-institution"
            className="co-field"
            disabled={!list}
            value={bank.institution}
            onChange={(e) => {
              const next = list?.find((entry) => entry.code === e.target.value);
              onBank({ institution: next?.code ?? "", bank: next?.name ?? "", accountName: "" });
            }}
          >
            <option value="">{list ? "Pick your bank" : "Loading the banks"}</option>
            {list?.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.type === "mobile_money" ? `${entry.name} (mobile money)` : entry.name}
              </option>
            ))}
          </select>
          <ChevronDown
            size={17}
            className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[rgba(233,241,236,.5)]"
          />
        </div>
      )}

      <label className="co-label mt-5" htmlFor="cashout-account">
        {mobile ? "Phone number" : "Account number"}
      </label>
      <input
        id="cashout-account"
        className="co-field co-mono mt-2"
        placeholder={bank.currency === "NGN" && !mobile ? "10-digit account number" : mobile ? "Phone number" : "Account number"}
        inputMode="numeric"
        autoComplete="off"
        autoCorrect="off"
        maxLength={20}
        disabled={!bank.institution}
        aria-invalid={Boolean(name.problem) || undefined}
        value={bank.accountNumber}
        onChange={(e) => onBank({ accountNumber: e.target.value.replace(/[^0-9]/g, ""), accountName: "" })}
      />

      <div className="mt-2 min-h-[1.5rem]" aria-live="polite">
        {!name.ready ? (
          bank.institution && bank.accountNumber.length > 0 ? (
            <span className="co-hint">
              Keep going: at least {accountLength(bank.currency)} digits.
            </span>
          ) : null
        ) : name.checking ? (
          <span className="co-hint inline-flex items-center gap-2">
            <Loader2 size={13} className="co-spin" /> Asking the bank whose account this is
          </span>
        ) : name.problem ? (
          <span className="grid justify-items-start gap-1">
            <span className="co-error">{name.problem}</span>
            <button type="button" className="co-link" onClick={name.retry}>
              Check again
            </button>
          </span>
        ) : name.name ? (
          <span className="co-ok inline-flex items-center gap-1.5">
            <Check size={14} strokeWidth={2.8} /> {name.name}
          </span>
        ) : (
          <span className="co-hint">The bank found the account but does not share names. Type the name on it below.</span>
        )}
      </div>

      {name.checked && !name.problem && !name.name && (
        <input
          aria-label="Name on the account"
          className="co-field mt-1"
          placeholder="Name on the account"
          autoCapitalize="words"
          value={bank.accountName}
          onChange={(e) => onBank({ accountName: e.target.value })}
        />
      )}

      <div className="mt-4">
        <BankQuoteCard quote={quote} />
      </div>

      <div className="mt-4">
        <Note tone="warn" icon={<AlertTriangle size={15} />}>
          Only an account in your own name. Once Paycrest has paid a bank, it cannot be pulled back; if the swap on the
          way fails, the USDC comes back to your Selkie account.
        </Note>
      </div>
    </>
  );
}

/**
 * The currency picker. One highlight glides from the old country to the new
 * one instead of two chips swapping colour, so the eye follows the change.
 * The glide is measured from the chips themselves, so it survives wrapping
 * onto two lines on a narrow phone.
 */
function CurrencyChips({ value, onPick }: { value: string; onPick: (code: BankCurrency) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [glide, setGlide] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const place = () => {
      const chip = el.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (chip) setGlide({ x: chip.offsetLeft, y: chip.offsetTop, w: chip.offsetWidth, h: chip.offsetHeight });
    };
    place();
    const watch = new ResizeObserver(place);
    watch.observe(el);
    return () => watch.disconnect();
  }, [value]);

  return (
    <div ref={box} className="co-chips mt-2" role="group" aria-label="Currency" data-glide={glide ? "" : undefined}>
      {glide && (
        <span
          className="co-glide"
          aria-hidden="true"
          style={{ width: glide.w, height: glide.h, transform: `translate(${glide.x}px, ${glide.y}px)` }}
        />
      )}
      {BANK_CURRENCIES.map((option) => (
        <button
          key={option.code}
          type="button"
          className="co-chip"
          aria-pressed={value === option.code}
          onClick={() => onPick(option.code)}
        >
          {/* Decorative: the code and the hint below already name the country. */}
          <img src={option.flag} alt="" width={18} height={18} className="co-flag" />
          {option.code}
        </button>
      ))}
    </div>
  );
}

/** The rate and what arrives, right under the details it depends on. */
export function BankQuoteCard({ quote }: { quote: Quote }) {
  if (quote.error && !quote.quote) {
    return (
      <div className="co-receipt p-4">
        <p className="co-error">{quote.error}</p>
        <button type="button" className="co-link mt-2" onClick={quote.retry}>
          Ask again
        </button>
      </div>
    );
  }
  if (!quote.quote) {
    return (
      <div className="co-receipt">
        <Row label="They get" muted>
          <span className="inline-flex items-center gap-2">
            <Loader2 size={13} className="co-spin" /> Asking Paycrest for today's rate
          </span>
        </Row>
      </div>
    );
  }
  const q = quote.quote;
  return (
    <div className="co-receipt">
      <Row label="They get about">
        <b className="co-in co-figure">{fiat(q.fiatAmount, q.currency)}</b>
      </Row>
      <Row label="Rate">
        <span className="co-sgt">{fiat(q.rate, q.currency)}</span> <span className="co-soft">per USDC</span>
      </Row>
      {q.sendAbout && (
        <Row label="You send about">
          <span className="co-out">{money(q.sendAbout)}</span> <span className="co-soft">USDC</span>
        </Row>
      )}
      <Row label="Fees">
        <span className="co-soft">In the rate and the swap.</span> <span className="co-sgt">Selkie pays the network fee.</span>
      </Row>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[rgba(233,241,236,.06)] px-4 py-3">
        <Fresh at={quote.at} every={30} loading={quote.loading} />
        {!q.payoutsOn && (
          <span className="co-hint inline-flex items-center gap-1.5">
            <Eye size={13} /> {previewLabel(q)}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * A bank cash-out, followed live: the swap to Base and Paycrest's payout read
 * together every few seconds, ending in the amount and the account it reached.
 */
export function BankTimeline({
  order,
}: {
  order: { orderId: string; depositAddress: string; currency: string; fiatAmount: string; institutionName: string; accountLast4: string };
}) {
  const { status, problem } = useBankStatus(order.orderId, order.depositAddress);
  const links = [
    ...(status?.intents?.originTxs ?? []).map((url) => ({ url, label: "Transfer to NEAR Intents" })),
    ...(status?.intents?.destinationTxs ?? []).map((url) => ({ url, label: "Arrival at Paycrest on Base" })),
  ];
  const paid = status?.paycrest?.fiatAmount;
  return (
    <div aria-live="polite">
      <Timeline stages={bankStages(status, { ...order, fiatAmount: paid ?? order.fiatAmount })} />
      {problem && <p className="co-hint mt-3">Could not check just now. Trying again.</p>}
      {links.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
          {links.map((link) => (
            <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="co-link">
              {link.label} <ExternalLink size={12} />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
