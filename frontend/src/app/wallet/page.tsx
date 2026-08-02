"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Repeat } from "lucide-react";
import { Header, Shell, Spinner } from "@/components/Layout";
import { Redirect } from "@/components/Redirect";
import { ActivityFeed } from "@/components/wallet/ActivityFeed";
import { ConvertSheet } from "@/components/wallet/ConvertSheet";
import {
  ClaimCelebration,
  CreateAccountGate,
  LinkHandleBanner,
  MergePrompt,
} from "@/components/wallet/Prompts";
import { SendSheet } from "@/components/wallet/SendSheet";
import { useAuth } from "@/contexts/useAuth";
import { api, type ActivityEntry } from "@/lib/api";
import { DOLLAR, money, usd } from "@/lib/format";

/**
 * The wallet: what you have, what you can do with it, and what you did.
 *
 * Everything else in the app is a sheet on top of this one screen. A payment
 * app that makes people navigate to find their own money has already lost.
 */
export default function WalletPage() {
  const { status, user, balances, claimed, refresh } = useAuth();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [sending, setSending] = useState(false);
  const [converting, setConverting] = useState(false);

  const loadActivity = useCallback(async () => {
    try {
      setEntries(await api.activity());
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingFeed(false);
    }
  }, []);

  useEffect(() => {
    if (status === "ready") void loadActivity();
  }, [status, loadActivity]);

  if (status === "loading") return <Spinner />;
  if (status === "signed-out") return <Redirect to="/" />;
  if (status === "needs-account") {
    return (
      <>
        <Header />
        <CreateAccountGate />
      </>
    );
  }
  if (!user) return <Spinner />;

  const dollars = balances.find((balance) => balance.asset === DOLLAR)?.amount ?? "0";
  const others = balances.filter(
    (balance) => balance.asset !== DOLLAR && Number(balance.amount) > 0,
  );
  const payable = user.handles.length > 0;

  const afterMoneyMoved = () => {
    void refresh();
    void loadActivity();
  };

  return (
    <>
      <Header />
      <main className="pb-24 pt-8">
        <Shell>
          {/* The balance is the first thing on the page, in dollars, no decoration. */}
          <section className="chunk-gold p-7">
            <p className="eyebrow">Your balance</p>
            <p className="mt-2 font-display text-[3.25rem] font-bold leading-none tracking-tight">
              {usd(dollars)}
            </p>

            {others.length > 0 && (
              <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[14px] font-semibold text-pen/60">
                {others.map((balance) => (
                  <span key={balance.asset}>
                    {money(balance.amount)} {balance.asset}
                  </span>
                ))}
              </p>
            )}

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setSending(true)}
                disabled={!payable}
                title={payable ? undefined : "Add your X handle first"}
                className="btn btn-dark flex-1"
              >
                <ArrowUpRight size={17} strokeWidth={2.5} /> Send
              </button>
              <button onClick={() => setConverting(true)} className="btn btn-dim flex-1">
                <Repeat size={16} strokeWidth={2.4} /> Convert
              </button>
            </div>
          </section>

          {!payable && <LinkHandleBanner />}

          <ActivityFeed entries={entries} loading={loadingFeed} />
        </Shell>
      </main>

      {sending && (
        <SendSheet
          balance={dollars}
          onClose={() => setSending(false)}
          onSent={afterMoneyMoved}
        />
      )}
      {converting && (
        <ConvertSheet
          balances={balances}
          onClose={() => setConverting(false)}
          onConverted={afterMoneyMoved}
        />
      )}
      {claimed.length > 0 && <ClaimCelebration claimed={claimed} />}
      <MergePrompt />
    </>
  );
}
