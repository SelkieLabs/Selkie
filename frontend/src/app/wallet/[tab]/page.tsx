"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Header, Shell, Spinner } from "@/components/Layout";
import { Redirect } from "@/components/Redirect";
import { ActivityFeed } from "@/components/wallet/ActivityFeed";
import { BalanceCard } from "@/components/wallet/BalanceCard";
import { ConvertSheet } from "@/components/wallet/ConvertSheet";
import { PayManyPanel } from "@/components/wallet/PayManyPanel";
import {
  ClaimCelebration,
  CreateAccountGate,
  LinkHandleBanner,
  MergePrompt,
} from "@/components/wallet/Prompts";
import { Rail } from "@/components/wallet/Rail";
import { ReceivePanel } from "@/components/wallet/ReceivePanel";
import { RequestsPanel } from "@/components/wallet/RequestsPanel";
import { SendPanel } from "@/components/wallet/SendPanel";
import { useAuth } from "@/contexts/useAuth";
import { api, type ActivityEntry, type MoneyRequest } from "@/lib/api";
import { DOLLAR } from "@/lib/format";
import { isWalletTab } from "@/lib/tabs";

/**
 * The wallet.
 *
 * One shell, five tabs, and the two things that never move: your balance at the
 * top, the rail within reach. Everything a tab needs is loaded here rather than
 * inside it, because the rail has to know how many people are waiting on you no
 * matter which tab you happen to be looking at.
 */
export default function WalletTabPage() {
  const params = useParams<{ tab: string }>();
  const { status, user, balances, balancesReady, claimed, refresh } = useAuth();

  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loadingFeed, setLoadingFeed] = useState(true);
  const [incoming, setIncoming] = useState<MoneyRequest[]>([]);
  const [outgoing, setOutgoing] = useState<MoneyRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
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

  const loadRequests = useCallback(async () => {
    try {
      const { incoming: mine, outgoing: theirs } = await api.requests();
      setIncoming(mine);
      setOutgoing(theirs);
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingRequests(false);
    }
  }, []);

  useEffect(() => {
    if (status !== "ready") return;
    void loadActivity();
    void loadRequests();
  }, [status, loadActivity, loadRequests]);

  /**
   * Keep what is on screen true.
   *
   * The balance already refreshes on its own, and a balance that changes with no
   * matching line in the feed reads as a glitch. So the feed and the requests
   * count move with it: money that lands while you are watching appears, and the
   * rail's badge is right without a reload.
   *
   * Paused while the tab is hidden. Neither reload touches a loading flag, so
   * nothing flickers back to a skeleton underneath you.
   */
  useEffect(() => {
    if (status !== "ready") return;

    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void loadActivity();
      void loadRequests();
    };
    const timer = window.setInterval(tick, 15_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [status, loadActivity, loadRequests]);

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

  const tab = params?.tab ?? "";
  if (!isWalletTab(tab)) return <Redirect to="/wallet/activity" />;

  const dollars = balances.find((balance) => balance.asset === DOLLAR)?.amount ?? "0";
  const handle = user.handles[0] ? `@${user.handles[0].username}` : null;
  const waiting = incoming.filter((request) => request.status === "pending").length;

  const afterMoneyMoved = () => {
    void refresh();
    void loadActivity();
    void loadRequests();
  };

  return (
    <>
      <Header />
      <main className="pb-32 pt-8 lg:pb-24">
        <Shell wide>
          <div className="flex gap-8 xl:gap-10">
            <Rail active={tab} waiting={waiting} />

            <div className="min-w-0 flex-1 space-y-6">
              <BalanceCard
                balances={balances}
                loading={!balancesReady}
                onConvert={() => setConverting(true)}
              />

              {!handle && <LinkHandleBanner />}

              {tab === "activity" && (
                <ActivityFeed entries={entries} loading={loadingFeed} onChanged={afterMoneyMoved} />
              )}

              {tab === "send" && (
                <SendPanel balance={dollars} entries={entries} onSent={afterMoneyMoved} />
              )}

              {tab === "receive" && <ReceivePanel handle={handle} />}

              {tab === "requests" && (
                <RequestsPanel
                  incoming={incoming}
                  outgoing={outgoing}
                  loading={loadingRequests}
                  canAsk={handle !== null}
                  onChanged={afterMoneyMoved}
                />
              )}

              {tab === "many" && <PayManyPanel balance={dollars} onSent={afterMoneyMoved} />}
            </div>
          </div>
        </Shell>
      </main>

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
