"use client";

import { useState, type ReactNode } from "react";
import { Lock, Smartphone, Sparkles, Tv, Wifi, Zap } from "lucide-react";
import { Back } from "./bits";

/**
 * Airtime, data and bills: shown now, switched on with mainnet.
 *
 * It sits in Cash out because it is a way money leaves: USDC in, a top-up or a
 * paid bill out. Nothing here moves money. The receipt is an example, labelled
 * as one, so the page can show exactly what paying a bill will feel like without
 * quoting a price that does not exist yet.
 */

type Service = "airtime" | "data" | "power" | "tv";

interface Example {
  icon: ReactNode;
  name: string;
  what: string;
  /** The receipt's headline: what you get. */
  headline: string;
  rows: [string, string][];
  /** The one thing that differs per service, said under the receipt. */
  after: string;
}

const SERVICES: Record<Service, Example> = {
  airtime: {
    icon: <Smartphone size={20} strokeWidth={2.1} />,
    name: "Airtime",
    what: "MTN, Airtel, Glo, 9mobile",
    headline: "₦1,000 airtime",
    rows: [
      ["Phone", "0803 ••• 4521"],
      ["Network", "MTN"],
    ],
    after: "The top-up lands on the phone in seconds. Yours, or anyone's.",
  },
  data: {
    icon: <Wifi size={20} strokeWidth={2.1} />,
    name: "Data",
    what: "Daily, weekly and monthly bundles",
    headline: "1.5 GB for 30 days",
    rows: [
      ["Phone", "0812 ••• 9034"],
      ["Network", "Airtel"],
    ],
    after: "Pick a bundle by size and days. It is on the line before you close the app.",
  },
  power: {
    icon: <Zap size={20} strokeWidth={2.1} />,
    name: "Electricity",
    what: "Prepaid and postpaid meters",
    headline: "₦5,000 of power",
    rows: [
      ["Meter", "4512 ••• 0098"],
      ["Company", "Ikeja Electric"],
    ],
    after: "The meter checks out before you pay, and your token shows right here.",
  },
  tv: {
    icon: <Tv size={20} strokeWidth={2.1} />,
    name: "TV",
    what: "DStv, GOtv, StarTimes",
    headline: "GOtv Max, one month",
    rows: [
      ["Smartcard", "7023 ••• 7781"],
      ["Name on it", "A. Okafor"],
    ],
    after: "The name on the card shows before you pay, so it never goes to the wrong decoder.",
  },
};

const ORDER: Service[] = ["airtime", "data", "power", "tv"];

const STEPS = [
  "Pick a service and type the number, meter or smartcard.",
  "See the price in USDC at the live rate, and who it is for.",
  "Approve with your key. Selkie pays the network fee.",
];

export function BillsSoon({ onBack }: { onBack: () => void }) {
  const [service, setService] = useState<Service>("airtime");
  const example = SERVICES[service];

  return (
    <div className="co-bills">
      <div className="co-top">
        <p className="co-kicker">
          <i aria-hidden="true" />
          Cash out
        </p>
        <Back onClick={onBack} />
      </div>

      <div className="mt-6">
        <p className="co-bills-soon">
          <Sparkles size={13} aria-hidden="true" /> Coming with mainnet
        </p>
        <h1 className="co-title mt-3">Airtime, data and bills</h1>
        <p className="co-blurb">
          Top up a phone, buy data, keep the lights on. Paid straight from your USDC, with no bank in between.
        </p>
      </div>

      <div className="co-bills-grid mt-6" role="group" aria-label="Services">
        {ORDER.map((key) => {
          const item = SERVICES[key];
          return (
            <button
              key={key}
              type="button"
              className="co-bills-tile"
              data-service={key}
              aria-pressed={service === key}
              onClick={() => setService(key)}
            >
              <span className="co-bills-tile-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="co-bills-tile-name">{item.name}</span>
              <span className="co-bills-tile-what">{item.what}</span>
            </button>
          );
        })}
      </div>

      <figure className="co-bills-receipt" data-service={service} aria-live="polite">
        <span className="co-bills-tag">Example</span>
        <div key={service} className="co-bills-receipt-body">
          <div className="co-bills-receipt-head">
            <span className="co-bills-receipt-icon" aria-hidden="true">
              {example.icon}
            </span>
            <div className="min-w-0">
              <p className="co-bills-receipt-title">{example.headline}</p>
              <p className="co-bills-receipt-sub">{example.name}, paid from your Selkie balance</p>
            </div>
          </div>
          <dl className="co-bills-rows">
            {[...example.rows, ["You pay", "USDC, at the live rate"], ["Network fee", "Paid by Selkie"], ["Arrives", "In seconds"]].map(
              ([label, value]) => (
                <div key={label} className="co-bills-row">
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ),
            )}
          </dl>
          <figcaption className="co-bills-after">{example.after}</figcaption>
        </div>
      </figure>

      <ol className="co-bills-steps">
        {STEPS.map((step, index) => (
          <li key={step}>
            <span className="co-bills-step-n" aria-hidden="true">
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      {/* No dead "Pay" button: the way forward is back to what works today. */}
      <button type="button" className="co-btn mt-7" onClick={onBack}>
        Back to Cash out
      </button>
      <p className="co-bills-foot">
        <Lock size={12} aria-hidden="true" /> Opens with mainnet, starting in Nigeria.
      </p>
    </div>
  );
}

/** The card on "Where should it go?" that opens the preview. */
export function BillsTeaser({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="co-bills-teaser" onClick={onOpen}>
      <span className="co-bills-stack" aria-hidden="true">
        {ORDER.map((key) => (
          <span key={key} data-service={key}>
            {SERVICES[key].icon}
          </span>
        ))}
      </span>
      <span className="min-w-0">
        <span className="co-choice-title">Airtime, data and bills</span>
        <span className="co-choice-what">Top up a phone, buy data, pay for power and TV, from your USDC.</span>
      </span>
      <span className="co-bills-badge">Soon</span>
    </button>
  );
}
