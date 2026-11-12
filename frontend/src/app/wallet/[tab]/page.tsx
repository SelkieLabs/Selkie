"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Header, Shell, Spinner } from "@/components/Layout";
import { Redirect } from "@/components/Redirect";
import { ActivityFeed } from "@/components/wallet/ActivityFeed";
import { AssetList, BalanceActions, BalanceCard } from "@/components/wallet/BalanceCard";
import { CashOutPanel } from "@/components/wallet/CashOutPanel";
import { ConvertSheet } from "@/components/wallet/ConvertSheet";
import { QuickSend, WaitingCard } from "@/components/wallet/HomeSide";
import { PayManyPanel } from "@/components/wallet/PayManyPanel";
import {
  ClaimCelebration,
  CreateAccountGate,
  LinkHandleBanner,
  MergePrompt,
  NotifyNudge,
} from "@/components/wallet/Prompts";
import { Rail } from "@/components/wallet/Rail";
import { ReceivePanel } from "@/components/wallet/ReceivePanel";
import { RequestsPanel } from "@/components/wallet/RequestsPanel";
import { SendPanel } from "@/components/wallet/SendPanel";
import { SettingsPanel } from "@/components/wallet/SettingsPanel";
import { useAuth } from "@/contexts/useAuth";
import { api, type ActivityEntry, type MoneyRequest, type User } from "@/lib/api";
import { features, isNear } from "@/lib/chain";
import { DOLLAR } from "@/lib/format";
import { isWalletTab } from "@/lib/tabs";
import { useArrivals } from "@/lib/useArrivals";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import { displayNameOf } from "@/lib/user";

/**
 * The wallet.
 *
 * One shell, seven tabs. Home is the overview (balance, what to do next, what
 * happened, what is still waiting); every other tab is one job in one column. Everything a tab needs is loaded here rather than
 * inside it, because the rail has to know how many people are waiting on you no
 * matter which tab you happen to be looking at.
 */
export default function WalletTabPage() {
  const params = useParams<{ tab: string }>();
  const { status, user, balances, balancesReady, claimed, refresh } = useAuth();

  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loadingFeed, setLoadingFeed] = useState(true);
  // Set only by a load that worked: a failed first load must not make the next
  // one look like a pile of brand-new payments.
  const [feedLoaded, setFeedLoaded] = useState(false);
  const [incoming, setIncoming] = useState<MoneyRequest[]>([]);
  const [outgoing, setOutgoing] = useState<MoneyRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  // Says the list could not be read, so an empty one is not mistaken for "nobody asked".
  const [requestsFailed, setRequestsFailed] = useState(false);
  const [converting, setConverting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadActivity = useCallback(async () => {
    try {
      setEntries(await api.activity());
      setFeedLoaded(true);
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingFeed(false);
    }
  }, []);

  const loadRequests = useCallback(async () => {
    // Where the chain has no requests there is no endpoint to ask, and asking
    // every fifteen seconds would just fill the console with 404s.
    if (!features.requests) {
      setLoadingRequests(false);
      return;
    }
    try {
      const { incoming: mine, outgoing: theirs } = await api.requests();
      setIncoming(mine);
      setOutgoing(theirs);
      setRequestsFailed(false);
    } catch (error) {
      console.error(error);
      setRequestsFailed(true);
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
   *
   * Balance before feed: reading the balance is when the API notices money
   * that came from outside Selkie and writes it to the feed, so the feed read
   * after it already has the line.
   */
  useLiveRefresh(
    useCallback(() => {
      void refresh().finally(() => void loadActivity());
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
  useArrivals(entries, feedLoaded);

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
      <Header app />
      <main className="pb-20 pt-3 lg:pt-5">
        <Shell app>
          <div className="flex gap-7">
            <Rail active={tab} waiting={waiting} />

            <div className="min-w-0 flex-1">
              {!handle && tab !== "settings" && (
                <div className="mb-5">
                  <LinkHandleBanner />
                </div>
              )}

              {tab === "home" ? (
                <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_23.25rem] xl:items-start">
                  <div className="min-w-0 space-y-4">
                    <Hello user={user} />
                    <BalanceCard
                      user={user}
                      balances={balances}
                      loading={!balancesReady}
                      refreshing={refreshing}
                      onRefresh={() => void refreshAll()}
                    />
                    <BalanceActions
                      balances={balances}
                      onConvert={features.convert ? () => setConverting(true) : undefined}
                    />
                    <NotifyNudge />
                    {/* On a narrower screen the side column has nowhere to go,
                        so what is waiting comes before the history. */}
                    <div className="xl:hidden">
                      <WaitingCard entries={entries} />
                    </div>
                    <ActivityFeed entries={entries} loading={loadingFeed} onChanged={afterMoneyMoved} />
                    {!isNear && (
                      <div className="xl:hidden">
                        <AssetList balances={balances} loading={!balancesReady} />
                      </div>
                    )}
                  </div>

                  <aside className="hidden space-y-4 xl:sticky xl:top-24 xl:block">
                    <QuickSend balance={dollars} />
                    <WaitingCard entries={entries} />
                    {!isNear && <AssetList balances={balances} loading={!balancesReady} />}
                  </aside>
                </div>
              ) : (
                // Every other tab is one job, so it gets one calm column. The
                // key makes each tab arrive rather than swap in place.
                <div key={tab} className="step-in mx-auto w-full max-w-[48rem] space-y-6">
                  {tab === "send" && (
                    <SendPanel balance={dollars} entries={entries} onSent={afterMoneyMoved} />
                  )}

                  {tab === "receive" && <ReceivePanel handle={handle} />}

                  {tab === "cashout" && <CashOutPanel balance={dollars} onSent={afterMoneyMoved} />}

                  {tab === "requests" && (
                    <RequestsPanel
                      incoming={incoming}
                      outgoing={outgoing}
                      loading={loadingRequests}
                      failed={requestsFailed}
                      onRetry={() => void loadRequests()}
                      canAsk={handle !== null}
                      onChanged={afterMoneyMoved}
                    />
                  )}

                  {tab === "many" && <PayManyPanel balance={dollars} onSent={afterMoneyMoved} />}

                  {tab === "settings" && <SettingsPanel user={user} />}
                </div>
              )}
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

/** "Good evening, Tunde", and the day, so Home opens like it knows you. */
function Hello({ user }: { user: User }) {
  const name = displayNameOf(user);
  const first = name.startsWith("@") ? name : (name.split(/\s+/)[0] ?? name);
  const hour = new Date().getHours();
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pt-1">
      <h1 className="font-display text-[1.6rem] font-extrabold leading-tight tracking-[-0.035em] sm:text-[1.875rem]">
        Good {part}, {first}
      </h1>
      <span className="text-[13.5px] text-pen/45">{today}</span>
    </div>
  );
}
