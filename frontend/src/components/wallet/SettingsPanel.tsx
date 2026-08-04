"use client";

import { useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  LogOut,
  MessageCircle,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { Panel, PanelHead } from "@/components/wallet/Panel";
import { useToast } from "@/contexts/ToastContext";
import { useAuth } from "@/contexts/useAuth";
import type { Handle, Identity, User } from "@/lib/api";

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
  const { linkX, linkTelegram, signOut } = useAuth();
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
          <p className="mt-5 rounded-2xl border-2 border-dashed border-pen/15 p-4 text-[15px] text-pen/60">
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
          {!linked.has("telegram") && (
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
          blurb="Any one of these opens the same wallet."
        />
        <ul className="mt-5 space-y-2.5">
          {user.identities.map((identity) => (
            <IdentityRow key={identity.provider} identity={identity} />
          ))}
        </ul>
      </Panel>

      <Panel>
        <PanelHead
          eyebrow="Wallet"
          title="Where your money lives"
          blurb="Your own address on Stellar. Share it to receive, and check it whenever you want to see the money for yourself."
        />
        <AddressRow address={user.address} />
      </Panel>

      <Panel>
        <PanelHead eyebrow="Account" title="Leave" />
        <p className="mt-1 text-[15px] leading-relaxed text-pen/60">
          Signing out does not touch your money. Sign back in with any login above and everything is
          where you left it.
        </p>
        <button
          onClick={() => {
            setLeaving(true);
            void signOut();
          }}
          disabled={leaving}
          className="btn btn-danger btn-sm mt-5"
        >
          {leaving ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
          {leaving ? "Signing out" : "Sign out"}
        </button>
      </Panel>
    </div>
  );
}

function HandleRow({ handle }: { handle: Handle }) {
  const provider = PROVIDERS[handle.platform];
  return (
    <li className="flex items-center gap-3 rounded-2xl border-2 border-pen/12 bg-card-bright/60 p-3.5">
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
    <li className="flex items-center gap-3 rounded-2xl border-2 border-pen/12 bg-card-bright/60 p-3.5">
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
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast("error", "Could not copy. Select the address and copy it by hand.");
    }
  };

  return (
    <div className="mt-5">
      <p className="break-all rounded-2xl border-2 border-pen/12 bg-card-bright/60 p-3.5 font-mono text-[13px] leading-relaxed text-pen/75">
        {address}
      </p>
      <div className="mt-3 flex flex-wrap gap-2.5">
        <button onClick={() => void copy()} className="btn btn-dim btn-sm">
          {copied ? <Check size={14} strokeWidth={2.8} /> : <Copy size={14} strokeWidth={2.5} />}
          {copied ? "Copied" : "Copy address"}
        </button>
        <a
          href={`https://stellar.expert/explorer/testnet/account/${address}`}
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
