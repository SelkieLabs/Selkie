import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ArrowRight, AtSign, Lock } from "lucide-react";
import { Header, Shell, Spinner } from "../components/Layout";
import { XLogo } from "../components/Mark";
import { TokenIcon } from "../components/TokenIcon";
import { api, type PublicAccount } from "../lib/api";
import { useAuth } from "../contexts/useAuth";

/** The redaction rows: proof there is a wallet here, with nothing readable. */
const PRIVATE_ROWS = ["CC", "USDCX", "CBTC", "CETH"];

/**
 * A handle's public page: shareable like a payment link.
 *
 * Dugong can show anyone's balances here because Sui is transparent. On Canton
 * a balance is not public data, so this page proves the handle can be paid and
 * deliberately shows nothing else. The absence is the feature.
 */
export function Account() {
  const { handle = "" } = useParams();
  const { me } = useAuth();
  const [account, setAccount] = useState<PublicAccount | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .account(handle)
      .then((a) => !cancelled && setAccount(a))
      .catch(() => !cancelled && setAccount(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [handle]);

  if (loading) return <Spinner />;

  const shown = account?.handle ?? `@${handle.replace(/^@/, "")}`;
  const isMe = me?.handle === shown;

  return (
    <>
      <Header />
      <main className="flex min-h-[calc(100vh-4rem)] flex-col justify-center py-12">
        <Shell>
          <div className="chunk mx-auto w-full max-w-md animate-rise p-8 text-center sm:p-10">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-full border-2 border-pen bg-[#f7ecd2] text-gold-ink">
              <AtSign size={26} />
            </span>

            <h1 className="mt-5 font-display text-[clamp(1.9rem,7vw,2.6rem)] font-bold tracking-tight">
              {shown}
            </h1>
            <p className="mt-2 text-sm font-medium text-pen/60">
              {account?.exists
                ? "Has a Selkie wallet and can be paid right now."
                : "No wallet yet. The first payment creates it."}
            </p>

            <div className="rule my-6" />

            <ul className="mx-auto max-w-[15rem] text-left">
              {PRIVATE_ROWS.map((asset) => (
                <li key={asset} className="flex items-center gap-3 py-2">
                  <TokenIcon asset={asset} size={24} />
                  <span className="h-3.5 w-24 rounded-full bg-pen/25 blur-[5px]" aria-hidden="true" />
                  <Lock size={11} className="ml-auto text-pen/40" />
                </li>
              ))}
            </ul>
            <p className="mx-auto mt-3 max-w-xs text-xs font-medium leading-relaxed text-pen/50">
              Balances are private on Canton. Only {shown} can see them.
            </p>

            <div className="mt-7">
              {me ? (
                <a
                  href={isMe ? "/dashboard/activity" : `/dashboard/send?to=${shown.replace("@", "")}`}
                  className="btn btn-gold"
                >
                  {isMe ? "Go to your wallet" : `Send to ${shown}`} <ArrowRight size={16} />
                </a>
              ) : (
                <a href="/auth/x/login" className="btn btn-gold">
                  <XLogo size={14} /> Continue with X to send
                </a>
              )}
            </div>
          </div>
        </Shell>
      </main>
    </>
  );
}
