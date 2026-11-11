"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Header, Shell, Spinner } from "@/components/Layout";
import { Redirect } from "@/components/Redirect";
import { ActivityFeed } from "@/components/wallet/ActivityFeed";
import { AssetList, BalanceCard } from "@/components/wallet/BalanceCard";
import { CashOutPanel } from "@/components/wallet/CashOutPanel";
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
import { SettingsPanel } from "@/components/wallet/SettingsPanel";
import { useAuth } from "@/contexts/useAuth";
import { api, type ActivityEntry, type MoneyRequest } from "@/lib/api";
import { DOLLAR } from "@/lib/format";
import { isWalletTab } from "@/lib/tabs";
import { useLiveRefresh } from "@/lib/useLiveRefresh";

/**
 * The wallet.
 *
 * One shell, six tabs, and the two things that never move: your balance at the
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
  const [refreshing, setRefreshing] = useState(false);

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
   * Money can arrive without this tab doing anything.
   *
   * A payment sent from a post on X, or one a friend sent you, used to leave
   * the wallet showing yesterday's story until somebody thought to press
   * refresh. Nothing on screen said it was stale, which is the worst kind of
   * wrong: an empty history looks exactly like a history that has not loaded.
   *
   * Quiet on purpose. No spinner and no flash, because this fires while the
   * person is reading and an unrequested loading state reads as a glitch.
   */
  useLiveRefresh(
    useCallback(() => {
      void refresh();
      void loadActivity();
      void loadRequests();
    }, [refresh, loadActivity, loadRequests]),
    { enabled: status === "ready" },
  );

  /**
   * Everything, on demand.
   *
   * The spinner runs for a beat longer than the request usually takes, because
   * a refresh that returns instantly with the same number looks like a button
   * that does nothing.
   */
  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    const started = Date.now();
    await Promise.allSettled([refresh(), loadActivity(), loadRequests()]);
    const elapsed = Date.now() - started;
    setTimeout(() => setRefreshing(false), Math.max(0, 450 - elapsed));
  }, [refresh, loadActivity, loadRequests]);

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
  if (!isWalletTab(tab)) return <Redirect to="/wallet/home" />;

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
              {/* Settings is about the account, not the money, so the balance
                  card would only be noise on it. */}
              {tab !== "settings" && (
                <BalanceCard
                  user={user}
                  balances={balances}
                  loading={!balancesReady}
                  refreshing={refreshing}
                  onRefresh={() => void refreshAll()}
                  onConvert={() => setConverting(true)}
                />
              )}

              {!handle && tab !== "settings" && <LinkHandleBanner />}

              {tab === "home" && (
                <div className="space-y-6">
                  <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
                    <ActivityFeed
                      entries={entries}
                      loading={loadingFeed}
                      onChanged={afterMoneyMoved}
                    />
                    <AssetList balances={balances} loading={!balancesReady} />
                  </div>
                </div>
              )}

              {tab === "send" && (
                <SendPanel balance={dollars} entries={entries} onSent={afterMoneyMoved} />
              )}

              {tab === "receive" && <ReceivePanel handle={handle} />}

              {tab === "cashout" && <CashOutPanel balance={dollars} />}

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

              {tab === "settings" && <SettingsPanel user={user} />}
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
