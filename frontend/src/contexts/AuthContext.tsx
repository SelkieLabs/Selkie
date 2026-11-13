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
import { isNear } from "@/lib/chain";
import { useNearWallet } from "@/lib/near-wallet";
import { stopPushHere } from "@/lib/push";
import { rememberSession } from "@/lib/session-hint";

/** Privy's linked-account types that are a way to sign in to Selkie (an identity), not a wallet. */
const SIGN_IN_TYPES = new Set<string>(["twitter_oauth", "telegram", "google_oauth"]);

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
  const { ensure: ensureNearWallet } = useNearWallet();

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

  /**
   * Create the Selkie account for this login.
   *
   * On NEAR the account's only key is the user's Privy NEAR wallet, so that
   * wallet has to exist before Selkie can open an account with it.
   */
  const openAccount = useCallback(async () => {
    if (isNear) await ensureNearWallet();
    return api.session({ createAccount: true });
  }, [ensureNearWallet]);

  /**
   * Trade the provider's token for a Selkie account.
   *
   * On Stellar an unknown login stops and asks, so one person never ends up
   * with two wallets. On NEAR the only door is X and the account is named after
   * that handle, so there is nothing to confuse it with: the account opens on
   * the first sign-in, and any money waiting for the handle lands with it. If
   * that fails the ask screen is still there to try again from.
   */
  const loadSession = useCallback(async () => {
    const mine = session.current;
    // Asked together: reading the session creates nothing, so there is no
    // reason to wait for the health check before starting it.
    const asked = api.session();
    asked.catch(() => {}); // handled below; this only stops an early return leaving it unhandled
    if (isNear) {
      // A NEAR web app pointed at the Stellar API signs people in to a Stellar
      // wallet under NEAR screens, and nothing else looks wrong. Stop at the door.
      const health = await api.health().catch(() => null);
      if (session.current !== mine) return;
      if (health && health.chain !== "near") {
        setProblem(
          "This Selkie is on NEAR, but the server it reached is the Stellar one, so nothing was opened. Point SELKIE_API_ORIGIN at the NEAR API.",
        );
        setStatus("signed-out");
        return;
      }
    }
    let result = await asked;
    if (session.current !== mine) return;

    if (result.status === "no-account" && isNear) {
      result = await openAccount().catch((error: unknown) => {
        console.error(error);
        return result;
      });
      if (session.current !== mine) return;
    }
    if (result.status === "no-account") {
      setUser(null);
      setStatus("needs-account");
      return;
    }
    setUser(result.user);
    setClaimed(result.claimed);
    setStatus("ready");
    await loadBalances();
  }, [loadBalances, openAccount]);

  // Remembered for the next visit, so the front page can open the wallet
  // straight away instead of showing the landing while the session loads.
  useEffect(() => {
    if (status !== "loading") rememberSession(status !== "signed-out");
  }, [status]);

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
    // On NEAR the account is opened from the X login and X is the only way in,
    // so there is never a second identity to attach (and no /auth/link route).
    if (isNear) return;
    // Only ways of signing in count. Privy also lists the embedded wallet it
    // made as a "linked account"; counting it made every wallet user look one
    // identity short and fire a link request on every load.
    const linked = privy.user?.linkedAccounts?.filter((account) => SIGN_IN_TYPES.has(account.type)).length ?? 0;
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
          // Before the session ends: unsubscribing needs it.
          await stopPushHere();
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
          const result = await openAccount();
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
      openAccount,
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
