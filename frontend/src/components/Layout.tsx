"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bird,
  Bot,
  Cat,
  Cherry,
  ChevronDown,
  Cookie,
  Croissant,
  Crown,
  Dice5,
  Dog,
  Fish,
  Gamepad2,
  Gem,
  Ghost,
  Grape,
  Home,
  IceCreamCone,
  LogOut,
  Menu,
  Origami,
  Panda,
  Pizza,
  Popcorn,
  Puzzle,
  Rabbit,
  Rocket,
  Settings,
  Shell as ShellIcon,
  Shrimp,
  Snail,
  Squirrel,
  Turtle,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { LoaderMark, Mark, Wordmark } from "./Mark";
import { SignOutModal } from "./SignOutModal";
import { useAuth } from "@/contexts/useAuth";
import type { User } from "@/lib/api";
import { isNear } from "@/lib/chain";
import { MENU_EVENT } from "@/lib/tabs";
import { avatarOf, handleOf } from "@/lib/user";

export function Shell({
  children,
  wide = false,
  app = false,
}: {
  children: ReactNode;
  wide?: boolean;
  /** The wallet: rail, main column and a side column, so it gets the most room. */
  app?: boolean;
}) {
  const width = app ? "max-w-[88rem]" : wide ? "max-w-6xl" : "max-w-2xl";
  return <div className={`mx-auto w-full px-4 sm:px-8 ${width}`}>{children}</div>;
}

// Sea creatures first, then toys and treats: someone who has not joined yet
// still gets a face of their own, and it is the same one every time.
const CREATURES: LucideIcon[] = [
  Fish, ShellIcon, Turtle, Shrimp, Snail, Bird, Rabbit, Cat, Dog, Squirrel, Panda, Origami,
  Ghost, Rocket, Bot, Gamepad2, Dice5, Puzzle, Crown, Gem, Cherry, Grape, Cookie,
  Croissant, IceCreamCone, Pizza, Popcorn,
];

/** A face, or the next best thing: their photo, or their own creature. Never a blank circle. */
export function Avatar({
  name,
  src,
  size = 32,
}: {
  name: string;
  src?: string | null;
  size?: number;
}) {
  const [broken, setBroken] = useState<string | null>(null);
  // Each name gets its own creature and colour of water, the same every time,
  // so people are told apart at a glance without anyone's photo.
  let hash = 0;
  for (const ch of name.replace(/^@/, "").toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = 30 + ((Math.imul(hash, 2654435761) >>> 0) % 300); // mixed, so names spread round the wheel (never alarm red)
  const Creature = CREATURES[(hash >>> 8) % CREATURES.length];
  return src && broken !== src ? (
    <img
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setBroken(src)}
      className="shrink-0 rounded-full object-cover ring-1 ring-pen/10"
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className="grid shrink-0 place-items-center rounded-full font-display font-extrabold"
      style={{
        width: size,
        height: size,
        color: `hsl(${hue} 75% 80%)`,
        background: `radial-gradient(circle at 30% 25%, hsl(${hue} 45% 34%), hsl(${hue} 50% 16%))`,
        boxShadow: `inset 0 0 0 1px hsl(${hue} 60% 60% / 0.3)`,
      }}
      aria-hidden="true"
    >
      <Creature size={Math.round(size * 0.52)} strokeWidth={2} />
    </span>
  );
}

/** The account pill: who you are, and the way out. */
function AccountPill({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const handle = handleOf(user);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account: ${handle}`}
        className="flex items-center gap-1.5 rounded-full p-0.5 pr-1.5 transition-colors duration-150 hover:bg-pen/[0.06]"
      >
        <Avatar name={handle} src={avatarOf(user)} size={36} />
        <ChevronDown
          size={15}
          className={`text-pen/50 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="menu" role="menu">
          <p className="px-3 pb-1.5 pt-2 text-[12.5px] text-pen/45">
            Signed in as <span className="font-semibold text-pen/80">{handle}</span>
          </p>
          <Link href="/wallet/home" onClick={() => setOpen(false)} className="menu-item" role="menuitem">
            <Wallet size={16} /> Your wallet
          </Link>
          <Link
            href="/wallet/settings"
            onClick={() => setOpen(false)}
            className="menu-item"
            role="menuitem"
          >
            <Settings size={16} /> Settings
          </Link>
          <Link href="/" onClick={() => setOpen(false)} className="menu-item" role="menuitem">
            <Home size={16} /> Home
          </Link>
          <div className="mx-2 my-1.5 rule" />
          <button
            onClick={() => {
              setOpen(false);
              setConfirmOut(true);
            }}
            className="menu-item text-[#f28b9b] hover:text-[#f28b9b]"
            role="menuitem"
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      )}

      {confirmOut && <SignOutModal name={handle} onClose={() => setConfirmOut(false)} />}
    </div>
  );
}

export function Header({ app = false }: { app?: boolean }) {
  const { user, status, signIn } = useAuth();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 14);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Sits on the water at the top; once content slides underneath, it grows a
  // blurred ink strip so the account chip never fights the page. (The
  // sign-out modal is portaled to <body>, so backdrop-filter cannot clip it.)
  return (
    <header
      className={`sticky top-0 z-40 border-b transition-[background-color,border-color,padding] duration-300 ${
        scrolled
          ? "border-pen/[0.07] bg-tide-0/75 py-2.5 backdrop-blur-xl"
          : "border-transparent bg-transparent pb-1 pt-4"
      }`}
    >
      <Shell wide={!app} app={app}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {app && (
              <button
                onClick={() => window.dispatchEvent(new Event(MENU_EVENT))}
                aria-label="Open menu"
                className="-ml-1.5 grid h-10 w-10 place-items-center rounded-xl text-pen/80 transition-colors hover:bg-pen/[0.06] hover:text-pen lg:hidden"
              >
                <Menu size={22} />
              </button>
            )}
            <Wordmark />
          </div>
          {/* Signed in, not merely "we still have a user object". Those came
              apart on sign out, and the pill went on showing somebody's name on
              a page they had just left. Read the state that decides, not the
              leftovers of the state before it. */}
          {status === "ready" && user ? (
            <div className="flex min-w-0 items-center gap-2.5">
              {/* Where the money lives, named after the handle: on NEAR that
                  name is the whole point, so it sits in the bar. */}
              {isNear && (
                <span className="acct-chip hidden sm:inline-flex" title={user.address}>
                  <i />
                  <span className="truncate">{user.address}</span>
                </span>
              )}
              <AccountPill user={user} />
            </div>
          ) : status === "loading" ? (
            <span className="skel h-10 w-28 rounded-full" aria-hidden="true" />
          ) : (
            <button onClick={signIn} className="btn btn-dim btn-sm">
              Sign in
            </button>
          )}
        </div>
      </Shell>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="mt-28 pb-10">
      <Shell wide>
        <div className="flex flex-col items-center justify-between gap-4 text-sm text-pen/50 sm:flex-row">
          <span className="flex items-center gap-2.5">
            <Mark size={18} />
            <span className="font-display font-extrabold text-pen/85">Selkie</span>
          </span>
          <nav className="flex items-center gap-6">
            <Link href="/docs" className="font-semibold transition-colors hover:text-ivory">
              Docs
            </Link>
            <a
              href="https://github.com/SelkieLabs/Selkie"
              target="_blank"
              rel="noreferrer"
              className="font-semibold transition-colors hover:text-ivory"
            >
              GitHub
            </a>
          </nav>
          <span>Send money to anyone with a handle</span>
        </div>
      </Shell>
    </footer>
  );
}

/** Full-screen branded loader: the echo mark pulsing over a sweeping sea-glass bar. */
export function Spinner() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5">
      <LoaderMark size={46} />
      <div className="loader-bar" />
    </div>
  );
}
