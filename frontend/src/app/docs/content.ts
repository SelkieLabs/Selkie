import {
  ArrowDownToLine,
  ArrowUpFromLine,
  AtSign,
  Bell,
  CircleHelp,
  Globe,
  Hourglass,
  Inbox,
  KeyRound,
  Landmark,
  LogIn,
  Send,
  ShieldCheck,
  Sparkles,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { NEAR_NETWORK, isNear } from "@/lib/chain";

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

/** The suffix every handle account sits under on this network. */
const HANDLE_SUFFIX = `x.selkiepay.${NEAR_NETWORK === "mainnet" ? "near" : "testnet"}`;

/**
 * The NEAR build. The account and its single key get a section of their own,
 * because that is the claim a reader can go and check. The X bot gets one too,
 * with exactly what it can spend, because a bot that moves money is the first
 * thing a careful reader will want bounded. Other chains and banks run on NEAR
 * mainnet, so those sections say plainly that testnet only shows a preview.
 */
const NEAR_SECTIONS: Section[] = [
  {
    id: "what-it-is",
    icon: Sparkles,
    title: "What Selkie is",
    lead: "Money that finds people by the name you already know them by.",
    blocks: [
      {
        p: "Selkie lets you send USDC to anyone using their X handle. You do not need their bank details, their phone number, or a long string of characters you have to copy correctly. You need the name you already call them.",
      },
      {
        p: "The person receiving it does not need to have heard of us. If they have not joined yet, the money waits for their X account, and it is theirs the moment they sign in. There is nothing for them to install and nothing for them to set up first.",
      },
      {
        p: "You can pay from the app or from a post on X. Money can come in from other chains, and go out to another chain or, on NEAR mainnet, to a bank account.",
      },
      {
        note: `Selkie runs on NEAR ${NEAR_NETWORK}. Your money sits in your own NEAR account, and you never pay gas.`,
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
          "Open Selkie and choose Continue with X.",
          `Selkie makes you a NEAR account named after your handle, like amaka.${HANDLE_SUFFIX}.`,
          "That is it. Anything already waiting for your handle lands straight away.",
        ],
      },
      {
        p: "You are not asked to write anything down, and there is no password to lose. Signing in with the same X account on a new phone gets you back to the same account and the same money.",
      },
    ],
  },
  {
    id: "your-account",
    icon: KeyRound,
    title: "Your NEAR account",
    lead: "Named after you, and only you hold its key.",
    blocks: [
      {
        p: `Your account is a real NEAR account with a name people can read: your X handle, then .${HANDLE_SUFFIX}. The name stays yours even if you later rename yourself on X.`,
      },
      {
        list: [
          "Its only key is yours, made for you when you first signed in.",
          "Selkie holds no key to it, so Selkie cannot move what is in it.",
          "You can check this yourself: open your account on the explorer and look at its keys. There is one.",
        ],
      },
      {
        note: "Your key is kept by Privy, the sign-in service Selkie uses, alongside your login. Selkie never sees it.",
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
          "Type the X handle you are paying. It does not matter whether they have an account.",
          "Type the amount, and add a note if you want them to know what it is for.",
          "Send it. You approve the payment with your key, and that is all.",
        ],
      },
      {
        p: "If they already have a Selkie account, it goes straight into their NEAR account in seconds. If they do not, see the next section.",
      },
      {
        p: "To pay several people the same amount, use Pay many: one list, one approval for all of them. People already on Selkie get theirs at once, and the rest wait for them.",
      },
      {
        p: `You can also pay any NEAR account by name, such as ${NEAR_NETWORK === "mainnet" ? "alice.near" : "alice.testnet"}. Pick "A NEAR account" on Send. That goes straight there, so nothing waits and nothing can be taken back. Check the name.`,
      },
      {
        note: "There is no gas to pay and no fee. You approve the payment, and Selkie pays the network cost of sending it. Selkie can pay for what you approved, but it cannot change it.",
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
        p: "The money waits in Selkie's escrow contract on NEAR, set aside for that X account. When they sign in with X, it is released into their own NEAR account.",
      },
      {
        list: [
          "Only the person who signs in with that X account can receive it.",
          "When Selkie can look the X account up, the money waits for the account itself, not just the username, so a renamed handle does not lose it.",
          "If nobody claims it before its waiting period ends, you can take it back.",
        ],
      },
      {
        note: "Selkie can do one thing with money that is waiting: release it to whoever signs in with that X account. It cannot take it, change the amount, or stop your refund.",
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
        p: "People pay you at your X handle. When something arrives it is in your NEAR account and in your activity, and you do not have to accept anything.",
      },
      {
        p: "If money was sent to you before you joined, it lands when you first sign in with X. You do not need a link, a code, or anything from the person who sent it.",
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
        p: "You can ask an X handle for an amount from Requests, and they see it the next time they open Selkie. If they have not joined yet, it waits for them. It sits there until they decide.",
      },
      {
        p: "Only the person you asked can turn a request into a payment, and they approve it with their own key, for exactly the amount you asked. Nobody can pull money out of your account by asking.",
      },
      {
        note: "This is why a request is safe to accept from anyone. The worst a bad one can do is waste a moment of your time.",
      },
    ],
  },
  {
    id: "on-x",
    icon: AtSign,
    title: "The X bot",
    lead: "Pay from a post on X.",
    blocks: [
      {
        p: "Mention @SelkiePay in a post or a reply and it answers. It reads a few plain commands, answers a question or a hello with its help card, and stays quiet about everything else, so talking about Selkie does not get you a reply.",
      },
      {
        commands: [
          { type: "@SelkiePay send 5 to @friend", does: "Pays 5 USDC to that handle, from your pocket or as a link you sign" },
          { type: "@SelkiePay send 5 USDC to @friend", does: "The same, naming what you are sending" },
          { type: "@SelkiePay pay @friend 20 for lunch", does: "The same, with a note attached" },
          { type: "@SelkiePay request 5 from @friend", does: "Makes the ask on the spot. They find it under Requests with a Pay button, and nothing moves until they pay" },
          { type: "@SelkiePay balance", does: "Points you to Selkie, without posting the number" },
          { type: "@SelkiePay activity", does: "The same, for your history" },
          { type: "@SelkiePay help", does: "Lists these commands" },
        ],
      },
      {
        p: "What a send does depends on whether you have filled an X pocket (see Tweet to pay):",
      },
      {
        list: [
          "You have a pocket and they are already on Selkie: it is paid there and then, and the reply links the payment on the explorer.",
          "No pocket, or they have not joined yet: the reply is a link that opens Send, filled in. Nothing moves until you check it and approve it with your own key. If they have not joined, it waits for them like any other payment.",
          "Your pocket is short for today: the reply carries the same link and says how much is left, so the payment is never stuck.",
          "Paid through the link: once it lands, the bot replies again in the same thread to say it is done. If they have not joined yet, that reply tags them and tells them to sign in with X to take it.",
        ],
      },
      {
        p: "The limits are what make it safe to have a bot at all:",
      },
      {
        list: [
          "USDC on NEAR only. Ask for anything else and the reply says so.",
          "Each tweet pays at most once, even if the bot reads it twice.",
          "Paying yourself, or the bot, is refused.",
          "Your balance and history are never posted. The bot points you to Selkie instead.",
          "The bot's key can do one thing: pay from a pocket, up to that pocket's daily limit, to a Selkie account. It cannot touch your account, and it cannot touch money waiting in escrow.",
        ],
      },
      {
        note: "The bot is a shortcut, not a requirement. Everything it does, the app does too.",
      },
    ],
  },
  {
    id: "tweet-to-pay",
    icon: Zap,
    title: "Tweet to pay",
    lead: "Fill a pocket once, and a tweet pays on the spot.",
    blocks: [
      {
        p: "An X pocket is a small amount you set aside for the bot to pay from. It sits in Selkie's pocket contract on NEAR, under your name, apart from your account.",
      },
      {
        steps: [
          "Open Tweet to pay in the wallet, or tap Fill your pocket on Home.",
          "Choose how much to put in and a daily limit. The limit starts at 10 USDC.",
          "Approve it with your key, once.",
          "Tweet \"@SelkiePay send 2 to @friend\". If they are on Selkie, it is paid from your pocket and the bot replies with the payment.",
        ],
      },
      {
        list: [
          "The daily limit resets at 00:00 UTC. Change it whenever you like.",
          "Withdraw what is left any time. It goes back to your account.",
          "Pocket payments go only to people already on Selkie. For anyone else the bot replies with a link, and once you sign it the money waits for them in escrow.",
        ],
      },
      {
        note: "A pocket is the only place the bot can spend from, and only up to your daily limit. Keep in it what you would be happy to tweet away in a day.",
      },
    ],
  },
  {
    id: "adding-money",
    icon: ArrowDownToLine,
    title: "Adding money",
    lead: "Into your NEAR account, from NEAR or another chain.",
    blocks: [
      {
        p: `Selkie on NEAR runs on ${NEAR_NETWORK}, so the money in it is test USDC with no real value. Receive shows your account name and a QR code: anyone can send USDC on NEAR ${NEAR_NETWORK} to it.`,
      },
      {
        p: "To get some test USDC, use Circle's USDC faucet and pick NEAR testnet. Selkie shows USDC only, so send nothing else to your account.",
      },
      {
        note: "To add money from another chain, such as USDT on Tron or USDC on Base, use Add money from another chain on Receive. See Any chain in, any chain out.",
      },
    ],
  },
  {
    id: "cashing-out",
    icon: ArrowUpFromLine,
    title: "Getting money out",
    lead: "To a NEAR account, another chain, or a bank.",
    blocks: [
      {
        steps: [
          "Go to Cash out and pick \"A NEAR account or exchange\".",
          "Type the amount and the account: your own NEAR wallet, or the NEAR deposit account an exchange shows you.",
          "Check the name, then approve it with your key. It arrives in seconds, and Selkie pays the network fee.",
        ],
      },
      {
        p: "Cash out offers two more ways out: Another chain, and A bank account. Each has a section of its own below.",
      },
    ],
  },
  {
    id: "other-chains",
    icon: Globe,
    title: "Any chain in, any chain out",
    lead: "NEAR Intents moves it between chains for you.",
    blocks: [
      {
        p: "Selkie keeps your money as USDC on NEAR. NEAR Intents is what lets it arrive from other chains and leave to them, without you touching a bridge or an exchange.",
      },
      {
        list: [
          "In: on Receive, open Add money from another chain. Pick what you are sending, such as USDT on Tron or USDC on Base, and your address there in case it has to come back. Selkie shows the price, then a deposit address. Send to it and it arrives as USDC in your NEAR account.",
          "Out: on Cash out, pick Another chain. Pick the coin and the chain, paste your address there, and approve it with your key. NEAR Intents swaps it on the way.",
          "Either way you see the price, fee included, before anything moves, and you can follow it until it lands.",
        ],
      },
      {
        note: "NEAR Intents runs on NEAR mainnet, so that is where these send for real. On testnet you see live prices marked Preview only, and nothing is sent.",
      },
    ],
  },
  {
    id: "bank",
    icon: Landmark,
    title: "Cash out to a bank",
    lead: "Local money, in a bank or mobile money account. On NEAR mainnet.",
    blocks: [
      {
        p: "A bank account, on Cash out, turns your USDC into local money: naira to any Nigerian bank, and shillings to a bank or mobile money account in Kenya, Uganda or Tanzania.",
      },
      {
        steps: [
          "Go to Cash out and pick A bank account.",
          "Pick the currency and the bank, then type the account number. Selkie looks up the name on the account as you type, so you can see it is the right person before anything moves.",
          "Type the amount. You see the live rate and what the bank pays out.",
          "Approve it with your key.",
        ],
      },
      {
        p: "On the way, NEAR Intents swaps your USDC on NEAR to USDC on Base, and Paycrest pays it out in local money.",
      },
      {
        note: "Bank payouts run on NEAR mainnet. On testnet you can go through every step with live rates, marked Preview only, and nothing is sent.",
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
          "Your account's only key is yours. Selkie holds none, so money in your account is out of its reach.",
          "Money waiting for an X account is released only to whoever signs in with it.",
          "The X bot can spend only from a pocket you filled, only up to your daily limit, and only to people on Selkie.",
        ],
      },
      {
        p: "Two things you do rely on. Privy keeps your key, the same way it keeps your sign-in. And Selkie's release service is what confirms an X sign-in before waiting money moves, so if it were ever compromised it could send waiting money to the wrong account. Money already in your account is not affected.",
      },
      {
        p: "If you fill an X pocket, you also trust the bot with that pocket. The most a stolen bot key could do is pay Selkie accounts from it, up to your daily limit. Withdraw it whenever you like.",
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
            a: "No. If they have not joined, the money waits for their X account until they sign in, then lands in their own NEAR account.",
          },
          {
            q: "What does it cost?",
            a: "Nothing to send and nothing to receive. Selkie pays the gas, so you never need NEAR in your account. Moving money to another chain or a bank has a fee, and it is in the price you see first.",
          },
          {
            q: "How long does it take?",
            a: "Seconds, if they already have an account. If they do not, it lands the moment they sign in.",
          },
          {
            q: "What if I send to the wrong handle?",
            a: "If they have an account it is gone, the same as handing cash to the wrong person. If they do not, it is still waiting and you can take it back once its waiting period ends.",
          },
          {
            q: "Can I pay from a tweet?",
            a: "Yes. Post \"@SelkiePay send 5 to @friend\". With an X pocket it is paid on the spot if they are on Selkie. Without one, the bot replies with a link you check and sign.",
          },
          {
            q: "Can the bot spend my money?",
            a: "Only what you put in your X pocket, only up to your daily limit, and only to people on Selkie. It holds no key to your account.",
          },
          {
            q: "Can I cash out to my bank?",
            a: "On NEAR mainnet, yes: naira to Nigerian banks, and shillings to banks and mobile money in Kenya, Uganda and Tanzania. On testnet you can walk through it with live rates as a preview.",
          },
          {
            q: "Can I sign in another way?",
            a: "Not on NEAR. Your account is named after your X handle, so X is how you sign in.",
          },
          {
            q: "Is my balance public?",
            a: "Selkie never posts it, and nor does the bot. But your account is a public NEAR account, so anyone who looks it up on the explorer can see what it holds, as with any account on a blockchain.",
          },
          {
            q: "Is this real money?",
            a: `Not yet. Selkie on NEAR was built at NEAR HACKATHON and runs on ${NEAR_NETWORK}, so balances are test USDC with no real value.`,
          },
          {
            q: "Do I need to know anything about crypto?",
            a: "No. You will never be asked for a seed phrase or to buy gas. If you want to look under the hood, your account is an ordinary NEAR account you can open on the explorer.",
          },
        ],
      },
    ],
  },
];

const STELLAR_SECTIONS: Section[] = [
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

export const SECTIONS: Section[] = isNear ? NEAR_SECTIONS : STELLAR_SECTIONS;
