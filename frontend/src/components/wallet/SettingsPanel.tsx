"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  Bell,
  BellRing,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  LogOut,
  Mail,
  MailCheck,
  MessageCircle,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { SignOutModal } from "@/components/SignOutModal";
import { Panel, PanelHead } from "@/components/wallet/Panel";
import { useToast } from "@/contexts/ToastContext";
import { useAuth } from "@/contexts/useAuth";
import { ApiError, api, type EmailStatus, type Handle, type Identity, type User } from "@/lib/api";
import { features, isNear } from "@/lib/chain";
import { explorer } from "@/lib/explorer";
import { usePush, type PushState } from "@/lib/push";

/** What each login is called in the interface, and what it can do. */
const PROVIDERS: Record<string, { label: string; payable: boolean }> = {
  google: { label: "Google", payable: false },
  x: { label: "X", payable: true },
  telegram: { label: "Telegram", payable: true },
};

/**
 * Settings.
 *
 * Three questions, in the order people ask them: who can pay me, where does my
 * money actually live, and how do I get out. Everything here is either an
 * account fact or a way to change one, and nothing is a preference toggle for
 * its own sake.
 */
export function SettingsPanel({ user }: { user: User }) {
  const { linkX, linkTelegram } = useAuth();
  const [leaving, setLeaving] = useState(false);

  const linked = new Set(user.identities.map((identity) => identity.provider));

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHead
          eyebrow="Handles"
          title="How people pay you"
          blurb="Anyone can send to these. Money addressed to a handle you have not linked yet waits until you do."
        />
        {user.handles.length > 0 ? (
          <ul className="mt-5 space-y-2.5">
            {user.handles.map((handle) => (
              <HandleRow key={`${handle.platform}:${handle.username}`} handle={handle} />
            ))}
          </ul>
        ) : (
          <p className="mt-5 rounded-2xl border border-dashed border-pen/15 p-4 text-[15px] text-pen/60">
            You have no payable handle yet. Add one and anything already waiting for it lands
            straight away.
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2.5">
          {!linked.has("x") && (
            <button onClick={() => void linkX()} className="btn btn-dark btn-sm">
              <Plus size={14} strokeWidth={2.6} /> Add X
            </button>
          )}
          {features.telegram && !linked.has("telegram") && (
            <button onClick={() => void linkTelegram()} className="btn btn-dark btn-sm">
              <MessageCircle size={14} strokeWidth={2.4} /> Add Telegram
            </button>
          )}
        </div>
      </Panel>

      <Panel>
        <PanelHead
          eyebrow="Sign in"
          title="Logins on this account"
          blurb={
            isNear
              ? "Signing in with X opens your NEAR account, on any device."
              : "Any one of these opens the same wallet."
          }
        />
        <ul className="mt-5 space-y-2.5">
          {user.identities.map((identity) => (
            <IdentityRow key={identity.provider} identity={identity} />
          ))}
        </ul>
      </Panel>

      <Panel>
        <PanelHead
          eyebrow={isNear ? "Account" : "Wallet"}
          title="Where your money lives"
          blurb={
            isNear
              ? "Your own NEAR account, named after your X handle. Its only key is yours; Selkie holds none. Share it to receive, and check it on the explorer whenever you like."
              : "Your own address on Stellar. Share it to receive, and check it whenever you want to see the money for yourself."
          }
        />
        <AddressRow address={user.address} />
      </Panel>

      {features.push && <NotificationsPanel />}

      <Panel>
        <PanelHead eyebrow="Account" title="Leave" />
        <p className="mt-1 text-[15px] leading-relaxed text-pen/60">
          {isNear
            ? "Signing out does not touch your money. Sign back in with X and everything is where you left it."
            : "Signing out does not touch your money. Sign back in with any login above and everything is where you left it."}
        </p>
        <button onClick={() => setLeaving(true)} className="btn btn-danger btn-sm mt-5">
          <LogOut size={14} /> Sign out
        </button>
      </Panel>

      {leaving && (
        <SignOutModal
          name={user.handles[0] ? `@${user.handles[0].username}` : undefined}
          onClose={() => setLeaving(false)}
        />
      )}
    </div>
  );
}

/** Why notifications cannot be switched on here, in words a person can act on. */
const PUSH_BLOCKERS: Partial<Record<PushState, string>> = {
  "install-first":
    "On iPhone and iPad, add Selkie to your Home Screen first: tap Share, then Add to Home Screen. Open Selkie from there and turn this on.",
  blocked: "Notifications are blocked for Selkie in this browser. Allow them in the browser's site settings, then come back here.",
  unsupported: "This browser cannot show notifications. Selkie still tells you when money comes in while it is open.",
  unavailable: "Notifications are not switched on for this server yet.",
};

/** Two ways to hear about money in: this device (push), and email. */
function NotificationsPanel() {
  return (
    <Panel>
      <PanelHead
        eyebrow="Notifications"
        title="When money comes in"
        blurb="Hear about it the moment someone pays you, even with Selkie closed."
      />
      <div className="mt-5 space-y-6">
        <section>
          <h3 className="text-[13px] font-medium text-pen/45">On this device</h3>
          <div className="mt-2.5">
            <PushNotices />
          </div>
        </section>
        <section>
          <h3 className="text-[13px] font-medium text-pen/45">By email</h3>
          <div className="mt-2.5">
            <EmailNotices />
          </div>
        </section>
      </div>
    </Panel>
  );
}

/** Push is per device, so this says "this device" every time it can. */
function PushNotices() {
  const { state, busy, error, turnOn, turnOff } = usePush();
  if (state === "checking") return <Loader2 size={16} className="animate-spin text-pen/40" />;
  const blocker = PUSH_BLOCKERS[state];

  return (
    <>
      <div>
        {blocker ? (
          <p className="text-[15px] leading-relaxed text-pen/60">{blocker}</p>
        ) : state === "on" ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 text-[15px] font-semibold text-[#2f7d3f]">
              <BellRing size={16} strokeWidth={2.4} /> On for this device
            </span>
            <button onClick={() => void turnOff()} disabled={busy} className="btn btn-dim btn-sm">
              {busy && <Loader2 size={14} className="animate-spin" />} Turn off
            </button>
          </div>
        ) : (
          <button onClick={() => void turnOn()} disabled={busy} className="btn btn-dark btn-sm">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Bell size={14} strokeWidth={2.4} />} Turn on
            notifications
          </button>
        )}
        {error && <p className="mt-3 text-[14px] font-medium text-[#b91c34]">{error}</p>}
      </div>
    </>
  );
}

/**
 * Email: type an address, get a code there, type the code back. Until the
 * code comes back nothing else is sent to it, so nobody can sign someone
 * else's inbox up for Selkie's mail.
 */
function EmailNotices() {
  const toast = useToast();
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.email
      .status()
      .then((found) => live && setStatus(found))
      .catch(() => live && setStatus({ available: false, email: null, verified: false, pending: false }));
    return () => {
      live = false;
    };
  }, []);

  const run = async (step: () => Promise<EmailStatus>, done?: string) => {
    setBusy(true);
    setError(null);
    try {
      const next = await step();
      setStatus(next);
      setChanging(false);
      setCode("");
      if (done) toast("success", done);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "That did not work. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  if (!status) return <Loader2 size={16} className="animate-spin text-pen/40" />;
  if (!status.available) {
    return <p className="text-[15px] leading-relaxed text-pen/60">Email notices are not switched on for this server yet.</p>;
  }

  const sendCode = (event: FormEvent) => {
    event.preventDefault();
    void run(() => api.email.start(address.trim()));
  };
  const confirm = (event: FormEvent) => {
    event.preventDefault();
    void run(() => api.email.verify(code), "Done. You will get an email when money comes in.");
  };
  const failed = error && <p className="mt-3 text-[14px] font-medium text-[#b91c34]">{error}</p>;

  if (status.verified && status.email && !changing) {
    return (
      <div>
        <p className="inline-flex flex-wrap items-center gap-2 text-[15px] font-semibold text-[#2f7d3f]">
          <MailCheck size={16} strokeWidth={2.4} /> Emails go to <span className="break-all text-pen">{status.email}</span>
        </p>
        <div className="mt-3 flex flex-wrap gap-2.5">
          <button onClick={() => setChanging(true)} disabled={busy} className="btn btn-dim btn-sm">
            Change address
          </button>
          <button onClick={() => void run(() => api.email.remove(), "Emails stopped.")} disabled={busy} className="btn btn-dim btn-sm">
            {busy && <Loader2 size={14} className="animate-spin" />} Stop emails
          </button>
        </div>
        {failed}
      </div>
    );
  }

  if (status.pending && status.email && !changing) {
    return (
      <form onSubmit={confirm}>
        <p className="text-[15px] leading-relaxed text-pen/70">
          We sent a 6-digit code to <span className="break-all font-semibold text-pen">{status.email}</span>. Enter it here.
        </p>
        <div className="mt-3 flex flex-wrap gap-2.5">
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            aria-label="Code from the email"
            className="field w-36 font-display font-bold tracking-[0.2em]"
          />
          <button type="submit" disabled={busy || code.length !== 6} className="btn btn-dark btn-sm">
            {busy && <Loader2 size={14} className="animate-spin" />} Confirm
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[14px] font-semibold text-pen/55">
          <button type="button" onClick={() => void run(() => api.email.start(status.email!))} disabled={busy} className="underline-offset-2 hover:underline">
            Send it again
          </button>
          <button type="button" onClick={() => setChanging(true)} disabled={busy} className="underline-offset-2 hover:underline">
            Use a different address
          </button>
        </div>
        {failed}
      </form>
    );
  }

  return (
    <form onSubmit={sendCode}>
      <div className="flex flex-wrap gap-2.5">
        <input
          type="email"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          autoComplete="email"
          placeholder="you@example.com"
          aria-label="Email address"
          className="field min-w-0 flex-1 basis-56"
        />
        <button type="submit" disabled={busy || !address.trim()} className="btn btn-dark btn-sm">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} strokeWidth={2.4} />} Send code
        </button>
      </div>
      {changing && (
        <button type="button" onClick={() => setChanging(false)} className="mt-3 text-[14px] font-semibold text-pen/55 underline-offset-2 hover:underline">
          Keep the current address
        </button>
      )}
      {failed}
    </form>
  );
}

function HandleRow({ handle }: { handle: Handle }) {
  const provider = PROVIDERS[handle.platform];
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-pen/12 bg-card-bright/60 p-3.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#2f7d3f]/12 text-[#2f7d3f]">
        <ShieldCheck size={17} strokeWidth={2.4} />
      </span>
      <div className="min-w-0">
        <p className="truncate font-display text-[15px] font-bold tracking-tight">
          @{handle.username}
        </p>
        <p className="text-[13px] font-medium text-pen/50">on {provider?.label ?? handle.platform}</p>
      </div>
      <span className="ml-auto shrink-0 rounded-full bg-[#2f7d3f]/12 px-2.5 py-1 text-[11px] font-bold text-[#2f7d3f]">
        Payable
      </span>
    </li>
  );
}

function IdentityRow({ identity }: { identity: Identity }) {
  const provider = PROVIDERS[identity.provider];
  const name = identity.displayName ?? identity.username;
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-pen/12 bg-card-bright/60 p-3.5">
      {identity.avatarUrl ? (
        <img
          src={identity.avatarUrl}
          alt=""
          width={36}
          height={36}
          className="h-9 w-9 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-pen/[0.08] font-display text-sm font-bold text-pen/60">
          {(provider?.label ?? identity.provider).slice(0, 1)}
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate font-display text-[15px] font-bold tracking-tight">
          {provider?.label ?? identity.provider}
        </p>
        {name && <p className="truncate text-[13px] font-medium text-pen/50">{name}</p>}
      </div>
    </li>
  );
}

function AddressRow({ address }: { address: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      toast("success", isNear ? "Account name copied." : "Address copied.");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast(
        "error",
        isNear
          ? "Could not copy. Select the account name and copy it by hand."
          : "Could not copy. Select the address and copy it by hand.",
      );
    }
  };

  return (
    <div className="mt-5">
      <p className="break-all rounded-2xl border border-pen/12 bg-card-bright/60 p-3.5 font-mono text-[13px] leading-relaxed text-pen/75">
        {address}
      </p>
      <div className="mt-3 flex flex-wrap gap-2.5">
        <button onClick={() => void copy()} className="btn btn-dim btn-sm">
          {copied ? <Check size={14} strokeWidth={2.8} /> : <Copy size={14} strokeWidth={2.5} />}
          {copied ? "Copied" : isNear ? "Copy account name" : "Copy address"}
        </button>
        <a
          href={explorer.account(address)}
          target="_blank"
          rel="noreferrer"
          className="btn btn-dim btn-sm"
        >
          <ExternalLink size={14} strokeWidth={2.4} /> View it yourself
        </a>
      </div>
    </div>
  );
}
