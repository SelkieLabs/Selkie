import {
  ArrowDownToLine,
  AtSign,
  Bell,
  CircleHelp,
  Hourglass,
  Inbox,
  LogIn,
  Send,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

/**
 * Everything the documentation says, as data.
 *
 * Kept apart from the page that renders it so the sidebar, the scroll spy and
 * the body can never disagree about what sections exist: they are all built
 * from this one list. Adding a section is adding an entry here, and the
 * navigation follows on its own.
 */

export interface Block {
  /** A paragraph. */
  p?: string;
  /** A short list of points. */
  list?: string[];
  /** A numbered walkthrough. */
  steps?: string[];
  /** Something to type, with what it does. */
  commands?: { type: string; does: string }[];
  /** A line worth pulling out of the flow. */
  note?: string;
  /** Questions and their answers, kept as pairs rather than run into prose. */
  qa?: { q: string; a: string }[];
}

export interface Section {
  id: string;
  title: string;
  /** Carried here rather than looked up by id, so a new section cannot be
   *  added without deciding what it looks like. */
  icon: LucideIcon;
  /** One line under the heading, before anything else. */
  lead?: string;
  blocks: Block[];
}

export const SECTIONS: Section[] = [
  {
    id: "what-it-is",
    icon: Sparkles,
    title: "What Selkie is",
    lead: "Money that finds people by the name you already know them by.",
    blocks: [
      {
        p: "Selkie lets you send money to anyone using their handle. You do not need their bank details, their phone number, or a long string of characters you have to copy correctly. You need the name you already call them.",
      },
      {
        p: "The person receiving it does not need to have heard of us. If they have not joined yet, the money is set aside for them and it is theirs the moment they sign in. There is nothing for them to install and nothing for them to set up first.",
      },
      {
        note: "You can send from the app or straight from a post on X. Both do exactly the same thing.",
      },
    ],
  },
  {
    id: "getting-started",
    icon: LogIn,
    title: "Getting started",
    lead: "One tap. There is no form.",
    blocks: [
      {
        steps: [
          "Open Selkie and choose Continue with X, Google or Telegram.",
          "That is it. Your account is ready and your handle is attached to it.",
        ],
      },
      {
        p: "You are not asked to write anything down, and there is no password to lose. Signing in again on a new phone gets you back to the same account and the same money.",
      },
      {
        p: "You can connect more than one account later. Your X and your Google can point at the same wallet, so people can pay you at whichever name they know you by.",
      },
    ],
  },
  {
    id: "sending",
    icon: Send,
    title: "Sending money",
    lead: "A name and an amount.",
    blocks: [
      {
        steps: [
          "Go to Send.",
          "Type the handle you are paying. It does not matter whether they have an account.",
          "Type the amount, and add a note if you want them to know what it is for.",
          "Send it.",
        ],
      },
      {
        p: "If they already have a Selkie account, it arrives in seconds and they see it immediately. If they do not, see the next section.",
      },
      {
        p: "You can also pay several people at once from Pay many, which is the same thing done in a batch: one list, one confirmation.",
      },
      {
        note: "There are no fees to send. You do not have to fund anything before you can pay someone.",
      },
    ],
  },
  {
    id: "waiting",
    icon: Hourglass,
    title: "When they have not joined yet",
    lead: "The money waits, and it stays yours until they take it.",
    blocks: [
      {
        p: "Sending to someone who has never used Selkie works exactly the same way. You do not have to check first, and you do not have to invite them.",
      },
      {
        p: "The money is set aside under their handle. Nobody can spend it in the meantime, including us. When they sign in with that handle, it lands in their wallet.",
      },
      {
        list: [
          "They get it by signing in with the same handle you sent it to.",
          "Nobody else can claim it, even if they know about it.",
          "If they never turn up, you can take it back.",
        ],
      },
      {
        note: "This is the part people find hard to believe. You can pay someone who does not know Selkie exists, and nothing about that is your problem to solve.",
      },
    ],
  },
  {
    id: "receiving",
    icon: Inbox,
    title: "Receiving money",
    lead: "There is nothing to do.",
    blocks: [
      {
        p: "People pay you at your handle. When something arrives it appears in your wallet and in your activity, and you do not have to accept anything.",
      },
      {
        p: "If money was sent to you before you joined, it is there waiting when you sign in with that handle. You do not need a link, a code, or anything from the person who sent it.",
      },
    ],
  },
  {
    id: "requests",
    icon: Bell,
    title: "Asking for money",
    lead: "A request moves nothing by itself.",
    blocks: [
      {
        p: "You can ask someone for an amount, and they see it next time they open Selkie. It sits there until they decide.",
      },
      {
        p: "Only the person you asked can turn a request into a payment. That is the whole of it: nobody can pull money out of your wallet by asking, however the request was made or who it came from.",
      },
      {
        note: "This is why a request is safe to accept from anyone. The worst a bad one can do is waste a moment of your time.",
      },
    ],
  },
  {
    id: "on-x",
    icon: AtSign,
    title: "Using Selkie on X",
    lead: "Post at @SelkiePay and it does the rest.",
    blocks: [
      {
        p: "Everything you can do in the app, you can do in a post. Reply to @SelkiePay or mention it anywhere, and it answers underneath.",
      },
      {
        commands: [
          { type: "@SelkiePay send 5 to @friend", does: "Sends 5 to that handle" },
          { type: "@SelkiePay send 5 USDC to @friend", does: "The same, naming what you are sending" },
          { type: "@SelkiePay pay @friend 20 for lunch", does: "Same thing, with a note attached" },
          { type: "@SelkiePay request 5 from @friend", does: "Asks them for 5" },
          { type: "@SelkiePay balance", does: "Points you to your wallet, without posting the number" },
          { type: "@SelkiePay activity", does: "The same, for your history" },
          { type: "@SelkiePay help", does: "The short version of this page" },
        ],
      },
      {
        p: "You need an account before you can send from a post, because a post proves who wrote it and not who owns the money. Selkie will tell you so and point you at the sign-in if you have not got one yet.",
      },
      {
        note: "Your balance and your history are never posted in public, not even to you. Ask for either on X and Selkie will hand you the door instead of the number.",
      },
      {
        p: "Send it to $5 and it reads as dollars. Leave out the amount word entirely and it assumes dollars too. If it cannot read what you wrote, it says so and shows you the format rather than guessing at an amount.",
      },
    ],
  },
  {
    id: "adding-money",
    icon: ArrowDownToLine,
    title: "Adding money",
    lead: "The one place a network gets named.",
    blocks: [
      {
        p: "Open Deposit and you get an address to send to, along with the list of what it accepts. Send only what is listed, and only over Stellar. Anything else sent to that address is gone, and there is nothing anyone can do about it afterwards.",
      },
      {
        p: "Selkie holds USDC and XLM. USDC is the dollar one, and it is what everything defaults to when nobody says otherwise.",
      },
      {
        note: "This is the only screen in Selkie that asks you to think about a network. Everywhere else it is a handle and an amount.",
      },
    ],
  },
  {
    id: "safety",
    icon: ShieldCheck,
    title: "Safety",
    lead: "What Selkie can and cannot do.",
    blocks: [
      {
        list: [
          "Nobody can move your money by messaging you, replying to you, or asking you for it.",
          "Selkie never asks you for a password, a code, or anything to write down, because there is nothing of that kind to give.",
          "Money set aside for a handle can only be claimed by someone signed in as that handle.",
          "A payment to an address that is one character wrong is refused rather than sent.",
        ],
      },
      {
        p: "Your balance and your history are yours. They are never shown in public, and Selkie will not post them on your timeline even if you ask it to in a public reply.",
      },
      {
        p: "What Selkie cannot do is undo a payment that has already landed. Sending money to the wrong handle is like handing cash to the wrong person: read the name before you send. Money still waiting to be claimed is the exception, and you can take that back.",
      },
    ],
  },
  {
    id: "questions",
    icon: CircleHelp,
    title: "Common questions",
    blocks: [
      {
        qa: [
          {
            q: "Does the person I am paying need an account?",
            a: "No. If they have not joined, the money waits for them under their handle until they sign in.",
          },
          {
            q: "What does it cost?",
            a: "Nothing to send and nothing to receive. You do not have to hold anything separate to cover a fee.",
          },
          {
            q: "How long does it take?",
            a: "Seconds, if they already have an account. If they do not, it lands the moment they sign in.",
          },
          {
            q: "What if I send to the wrong handle?",
            a: "If they have an account it is gone, the same as handing cash to the wrong person. If they do not, it is still waiting and you can take it back.",
          },
          {
            q: "Can I use more than one account?",
            a: "Yes. Connect your X, Google and Telegram to the same wallet and people can pay you at any of them.",
          },
          {
            q: "Is my balance public?",
            a: "No. It is never posted anywhere, including by the bot on X.",
          },
          {
            q: "Do I need to know anything about crypto?",
            a: "No, and you will not be asked to. The only screen that mentions a network is Deposit, because money arriving from outside has to arrive over something.",
          },
        ],
      },
    ],
  },
];
