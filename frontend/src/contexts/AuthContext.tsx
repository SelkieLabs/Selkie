"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePrivy } from "@privy-io/react-auth";
import {
  ApiError,
  api,
  setTokenProvider,
  type ClaimOutcome,
  type Money,
  type User,
} from "@/lib/api";

/**
 * Signing in, in one place.
 *
 *  - `loading`       we do not know yet, so show nothing that could flash
 *  - `signed-out`    no login at all
 *  - `needs-account` a real login we have never seen: ask once, then create
 *  - `ready`         a Selkie account with a wallet behind it
 *
 * That third state is the whole reason this is not two lines of code. Silently
 * creating an account for an unrecognised login is how one person ends up with
 * two wallets and their money in the wrong one.
 */
export type AuthStatus = "loading" | "signed-out" | "needs-account" | "ready";

export interface MergePrompt {
  fromUserId: string;
  address: string;
  message: string;
}

export interface AuthState {
  status: AuthStatus;
  user: User | null;
  balances: Money[];
  /** False until the first balance read comes back, so nothing shows "$0.00" too early. */
  balancesReady: boolean;
  /** Money that was waiting and just landed. Shown once, then dismissed. */
  claimed: ClaimOutcome[];
  merge: MergePrompt | null;
  busy: boolean;
  signIn: () => void;
  signOut: () => Promise<void>;
  createAccount: () => Promise<void>;
  linkX: () => Promise<void>;
  linkTelegram: () => Promise<void>;
  confirmMerge: () => Promise<void>;
  dismissMerge: () => void;
  dismissClaimed: () => void;
  refresh: () => Promise<void>;
}

const noop = async () => {};

// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext<AuthState>({
  status: "loading",
  user: null,
  balances: [],
  balancesReady: false,
  claimed: [],
  merge: null,
  busy: false,
  signIn: () => {},
  signOut: noop,
  createAccount: noop,
  linkX: noop,
  linkTelegram: noop,
  confirmMerge: noop,
  dismissMerge: () => {},
  dismissClaimed: () => {},
  refresh: noop,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const privy = usePrivy();
  const { ready, authenticated, getAccessToken } = privy;

  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [balances, setBalances] = useState<Money[]>([]);
  const [balancesReady, setBalancesReady] = useState(false);
  const [claimed, setClaimed] = useState<ClaimOutcome[]>([]);
  const [merge, setMerge] = useState<MergePrompt | null>(null);
  const [busy, setBusy] = useState(false);

  // Every API call reads the token through this, so it is always the live one.
  useEffect(() => {
    setTokenProvider(async () => (authenticated ? await getAccessToken() : null));
  }, [authenticated, getAccessToken]);

  const loadBalances = useCallback(async () => {
    try {
      const { user: fresh, balances: money } = await api.me();
      setUser(fresh);
      setBalances(money);
    } catch (error) {
      // A 401 here means the login went stale. Anything else is a network
      // hiccup, and that is not worth signing someone out over.
      if (error instanceof ApiError && error.status === 401) setStatus("signed-out");
      else console.error(error);
    } finally {
      // Even a failed read ends the wait: a skeleton that never resolves is
      // worse than a balance that admits it could not be fetched.
      setBalancesReady(true);
    }
  }, []);

  /** Trade the provider's token for a Selkie account, without creating one. */
  const loadSession = useCallback(async () => {
    const result = await api.session();
    if (result.status === "no-account") {
      setUser(null);
      setStatus("needs-account");
      return;
    }
    setUser(result.user);
    setClaimed(result.claimed);
    setStatus("ready");
    await loadBalances();
  }, [loadBalances]);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      setStatus("signed-out");
      setUser(null);
      setBalances([]);
      setBalancesReady(false);
      setClaimed([]);
      return;
    }
    void loadSession().catch((error) => {
      console.error(error);
      setStatus("signed-out");
    });
  }, [ready, authenticated, loadSession]);

  /**
   * Money can arrive while you are just looking at the screen: someone pays your
   * handle, or a payment you were waiting on lands. Without this the balance
   * stays whatever it was when the page loaded, and the app feels dead.
   *
   * Paused while the tab is hidden, and caught up the moment it comes back, so a
   * wallet left open in a background tab is not quietly polling all day.
   */
  useEffect(() => {
    if (status !== "ready") return;

    const tick = () => {
      if (document.visibilityState === "visible") void loadBalances();
    };
    const timer = window.setInterval(tick, 15_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [status, loadBalances]);

  /**
   * Attach an identity Privy has that the Selkie account does not.
   *
   * The user asked for this by tapping Link, so finishing it without a second
   * tap is seamless rather than silent. Merging is the opposite: it moves money
   * between two wallets, so it stops and asks.
   */
  const attempted = useRef(0);
  const attach = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) return;
    const result = await api.link(token);
    if (result.status === "merge-required") {
      setMerge({
        fromUserId: result.mergeCandidate.userId,
        address: result.mergeCandidate.address,
        message: result.message,
      });
      return;
    }
    setUser(result.user);
    if (result.claimed.length > 0) setClaimed(result.claimed);
    await loadBalances();
  }, [getAccessToken, loadBalances]);

  useEffect(() => {
    if (status !== "ready" || !user) return;
    const linked = privy.user?.linkedAccounts?.length ?? 0;
    // Once per newly linked account, so a failure never becomes a retry loop.
    if (linked <= user.identities.length || attempted.current === linked) return;
    attempted.current = linked;
    void attach().catch(console.error);
  }, [status, user, privy.user, attach]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      balances,
      balancesReady,
      claimed,
      merge,
      busy,
      signIn: () => privy.login(),
      signOut: async () => {
        await privy.logout();
        setUser(null);
        setBalances([]);
        setBalancesReady(false);
        setStatus("signed-out");
      },
      createAccount: async () => {
        setBusy(true);
        try {
          const result = await api.session({ createAccount: true });
          if (result.status === "no-account") return;
          setUser(result.user);
          setClaimed(result.claimed);
          setStatus("ready");
          await loadBalances();
        } finally {
          setBusy(false);
        }
      },
      // Privy opens its own flow and returns immediately; the effect above sees
      // the new identity land and finishes the link against Selkie. Both handles
      // work the same way, and either one releases money waiting for it.
      linkX: async () => privy.linkTwitter(),
      linkTelegram: async () => privy.linkTelegram(),
      confirmMerge: async () => {
        if (!merge) return;
        setBusy(true);
        try {
          const { user: merged } = await api.merge(merge.fromUserId);
          setUser(merged);
          setMerge(null);
          await loadBalances();
        } finally {
          setBusy(false);
        }
      },
      dismissMerge: () => setMerge(null),
      dismissClaimed: () => setClaimed([]),
      refresh: loadBalances,
    }),
    [status, user, balances, balancesReady, claimed, merge, busy, privy, loadBalances],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
