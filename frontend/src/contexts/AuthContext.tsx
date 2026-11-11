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
import { useLogin, usePrivy, type PrivyErrorCode } from "@privy-io/react-auth";
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
  /** Why the last sign-in did not work, in words a person can act on. */
  problem: string | null;
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
  problem: null,
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
  const [problem, setProblem] = useState<string | null>(null);

  // privy.login() returns nothing and never rejects, so a failed sign-in is
  // reported here or nowhere.
  const { login } = useLogin({
    onComplete: () => setProblem(null),
    onError: (code) => setProblem(signInProblem(code)),
  });

  /**
   * Which sign-in the replies still in the air belong to.
   *
   * The wallet reads `/me` every fifteen seconds and that read waits on the
   * ledger. Signing out mid-flight used to be undone by the reply landing
   * afterwards and setting the user again, which is how a signed-out landing
   * page kept showing somebody's name. A reply from an ended session is dropped.
   */
  const session = useRef(0);

  const forget = useCallback(() => {
    session.current += 1;
    setUser(null);
    setBalances([]);
    setBalancesReady(false);
    setClaimed([]);
    setMerge(null);
  }, []);

  // Every API call reads the token through this, so it is always the live one.
  useEffect(() => {
    setTokenProvider(async () => (authenticated ? await getAccessToken() : null));
  }, [authenticated, getAccessToken]);

  const loadBalances = useCallback(async () => {
    const mine = session.current;
    try {
      const { user: fresh, balances: money } = await api.me();
      if (session.current !== mine) return;
      setUser(fresh);
      setBalances(money);
    } catch (error) {
      if (session.current !== mine) return;
      // A 401 here means the login went stale. Anything else is a network
      // hiccup, and that is not worth signing someone out over.
      if (error instanceof ApiError && error.status === 401) setStatus("signed-out");
      else console.error(error);
    } finally {
      // Even a failed read ends the wait: a skeleton that never resolves is
      // worse than a balance that admits it could not be fetched.
      if (session.current === mine) setBalancesReady(true);
    }
  }, []);

  /** Trade the provider's token for a Selkie account, without creating one. */
  const loadSession = useCallback(async () => {
    const mine = session.current;
    const result = await api.session();
    if (session.current !== mine) return;

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
      forget();
      setStatus("signed-out");
      return;
    }
    void loadSession().catch((error) => {
      console.error(error);
      setStatus("signed-out");
    });
  }, [ready, authenticated, loadSession, forget]);

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
      problem,
      signIn: () => {
        setProblem(null);
        // Asking to log in while already logged in is an error, not a no-op, and
        // it is reachable: a half-torn-down session can leave the button on
        // screen with Privy still holding a login.
        if (authenticated) return;
        login();
      },
      signOut: async () => {
        try {
          await privy.logout();
        } catch (error) {
          // Signing out has to work even when the round trip does not. Leaving
          // somebody looking at their own name because a request failed is the
          // one outcome this must never have, so the local session ends either
          // way and a stale token is refused by the server anyway.
          console.error(error);
        } finally {
          forget();
          setStatus("signed-out");
        }
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
    [
      status,
      user,
      balances,
      balancesReady,
      claimed,
      merge,
      busy,
      problem,
      authenticated,
      privy,
      login,
      loadBalances,
      forget,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * What to say when a sign-in does not go through.
 *
 * Backing out on purpose says nothing: telling someone they did not do the
 * thing they just chose not to do is noise. Everything else gets the same
 * sentence, because the answer is the same in every case. By a distance the
 * commonest is `invalid_credentials`: the code X hands back is single-use and
 * short-lived, so a tab left open on the login screen or a reload part-way
 * through comes back "expired or invalid". Nothing is wrong. Start it again.
 */
function signInProblem(code: PrivyErrorCode): string | null {
  const backedOut = ["exited_auth_flow", "exited_link_flow", "oauth_user_denied"];
  if (backedOut.includes(code)) return null;
  return "That sign-in did not finish. Nothing has changed on your account, so tap sign in and try once more.";
}
