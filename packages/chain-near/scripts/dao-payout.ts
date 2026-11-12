/**
 * Pay people from a Sputnik DAO by X handle. Testnet only.
 *
 *   npm run near:dao -- create <name>               make <name>.sputnikv2.testnet, with NEAR_ROOT_ACCOUNT as its council
 *   npm run near:dao -- propose <dao> <file.csv>    one proposal that pays every @handle,amount line
 *   npm run near:dao -- propose <dao> <file.csv> --dry   print it, sign nothing
 *   npm run near:dao -- approve <dao> <id>          vote yes; with one council member that executes it
 *
 * The proposal is a single USDC ft_transfer_call to the escrow with a
 * hold_many msg (src/dao.ts). Once it executes, each amount waits for that X
 * account: a newcomer gets it when they first sign in to Selkie, a Selkie user
 * the next time they open the app. Money only leaves the DAO by its own vote;
 * this script signs as a DAO member, never as the DAO.
 *
 * Signs with DAO_SIGNER_ACCOUNT / DAO_SIGNER_KEY if set, else the root account.
 * The DAO needs USDC before the vote: send it test USDC (faucet.circle.com,
 * NEAR Testnet) at its account name. `create` registers it on USDC for that.
 *
 * With X_BEARER_TOKEN set, money waits for the numeric X user id, so a renamed
 * handle still gets paid; without it, for the username (design 5.3). Selkie
 * claims both kinds for whoever signs in.
 */
import { readFileSync } from "node:fs";
import { Account, nearToYocto, type KeyPairString } from "near-api-js";
import { failoverProvider } from "../src/rpc";
import { fromBaseUnits } from "../src/amounts";
import { NearChain } from "../src/chain";
import { nearConfigFromEnv } from "../src/config";
import {
  PAYOUT_EXECUTE_GAS,
  PayoutError,
  parsePayoutCsv,
  payoutProposal,
  proposalTotal,
  type PayoutRecipient,
} from "../src/dao";
import { TGAS, escrowEvents, firstFailure, type OutcomeLike } from "../src/escrow";
import { recipientKeyFor } from "../src/recipient";
import { topUpFromFaucet } from "./faucet";

/** The testnet Sputnik v2 factory: answers get_daos with thousands of DAOs (checked 11 Nov 2026). */
const FACTORY = process.env.SPUTNIK_FACTORY || "sputnikv2.testnet";
/** What recent DAOs from that factory hold: ~5.4 NEAR of contract storage plus room to work. */
const DAO_DEPOSIT = nearToYocto("6");

const config = nearConfigFromEnv();
if (config.network !== "testnet") throw new Error("near:dao runs on testnet only.");
const provider = failoverProvider(config.rpcUrls ?? [config.rpcUrl]);
const tx = (hash: string) => `${config.explorerUrl}/transactions/${hash}`;

function signer(): Account {
  const accountId = process.env.DAO_SIGNER_ACCOUNT || process.env.NEAR_ROOT_ACCOUNT;
  const key = (process.env.DAO_SIGNER_KEY || process.env.NEAR_ROOT_KEY) as KeyPairString | undefined;
  if (!accountId || !key) throw new Error("Set DAO_SIGNER_ACCOUNT and DAO_SIGNER_KEY, or NEAR_ROOT_ACCOUNT and NEAR_ROOT_KEY.");
  return new Account(accountId, provider, key);
}

async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await provider.callFunction({ contractId, method, args })) as T;
}

interface Policy {
  proposal_bond: string;
  roles: { name: string; kind: unknown; permissions: string[] }[];
}

interface Proposal {
  id: number;
  proposer: string;
  description: string;
  kind: unknown;
  status: string;
}

async function policyOf(dao: string): Promise<Policy> {
  try {
    return await view<Policy>(dao, "get_policy");
  } catch (error) {
    throw new Error(`${dao} does not answer get_policy, so it is not a Sputnik DAO: ${String(error).slice(0, 160)}`);
  }
}

/** The JSON a contract method returned, from the transaction's own status. */
function returned<T>(outcome: { status: unknown }): T | null {
  const status = outcome.status as { SuccessValue?: string } | undefined;
  if (!status?.SuccessValue) return null;
  return JSON.parse(Buffer.from(status.SuccessValue, "base64").toString("utf8")) as T;
}

/** @username -> numeric X id, or null. Same call as backend/api/src/near/x-lookup.ts. */
async function xIdOf(username: string): Promise<string | null> {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) return null;
  try {
    const response = await fetch(`https://api.x.com/2/users/by/username/${encodeURIComponent(username)}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: { id?: string } };
    return body.data?.id && /^\d{1,20}$/.test(body.data.id) ? body.data.id : null;
  } catch {
    return null;
  }
}

async function create(name: string) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) throw new Error("A DAO name is lowercase letters, digits and single dashes.");
  const dao = `${name}.${FACTORY}`;
  const council = signer();
  const chain = new NearChain(config);

  if (await chain.accountExists(dao)) {
    await policyOf(dao);
    console.log(`exists   ${dao}`);
  } else {
    for (const hash of await topUpFromFaucet(provider, council.accountId, DAO_DEPOSIT + nearToYocto("1"))) {
      console.log(`faucet   ${council.accountId} topped up: ${tx(hash)}`);
    }
    const args = {
      config: { name, purpose: "Pays contributors by X handle through Selkie", metadata: "" },
      // A plain list of accounts is Sputnik's default policy with them as the council.
      policy: [council.accountId],
    };
    const result = await council.callFunctionRaw({
      contractId: FACTORY,
      methodName: "create",
      args: { name, args: Buffer.from(JSON.stringify(args)).toString("base64") },
      deposit: DAO_DEPOSIT,
      gas: 300n * TGAS,
    });
    // `create` itself returns nothing (its callback's yes/no is not passed back),
    // and on failure the factory refunds the deposit. So ask the DAO directly.
    if (!(await chain.accountExists(dao))) throw new Error(`The factory did not create ${dao}: ${tx(result.transaction.hash)}`);
    await policyOf(dao);
    console.log(`created  ${dao}, council ${council.accountId}: ${tx(result.transaction.hash)}`);
  }

  const registered = await chain.registerForUsdc(dao);
  console.log(registered ? `usdc     registered ${dao}: ${tx(registered)}` : `usdc     ${dao} already registered`);
  console.log(`\nNext: send it test USDC at ${dao} (faucet.circle.com, NEAR Testnet), then propose.`);
}

async function propose(dao: string, csvPath: string, dry: boolean) {
  const rows = parsePayoutCsv(readFileSync(csvPath, "utf8"));
  const chain = new NearChain(config);
  const policy = await policyOf(dao);

  const people: (PayoutRecipient & { scheme: string })[] = [];
  for (const row of rows) {
    const key = await recipientKeyFor({ username: row.handle, xUserId: await xIdOf(row.handle) });
    people.push({ handle: row.handle, units: row.units, recipient: key.key, scheme: key.scheme });
  }
  const proposal = payoutProposal({
    usdc: config.usdcContract,
    escrow: config.escrowContract,
    people,
    lifetimeSecs: Number(process.env.SELKIE_CLAIM_LIFETIME_SECS || 2_592_000),
  });
  const total = proposalTotal(proposal);

  for (const person of people) {
    console.log(`  @${person.handle.padEnd(16)} ${fromBaseUnits(person.units).padStart(10)} USDC   waits for ${person.scheme}`);
  }
  console.log(`  ${"total".padEnd(17)} ${fromBaseUnits(total).padStart(10)} USDC`);

  // Nothing here stops a proposal, because the DAO may be topped up before the
  // vote. They are said now so a failed execution is never a surprise.
  if (!(await chain.isUsdcRegistered(dao))) {
    console.log(`\nwarning  ${dao} is not registered on USDC, so it cannot hold any. Run create, or storage_deposit for it.`);
  }
  const balance = await chain.usdcBalance(dao);
  if (balance < total) {
    console.log(`\nwarning  ${dao} holds ${fromBaseUnits(balance)} USDC; the payout needs ${fromBaseUnits(total)} by the time it is approved.`);
  }

  if (dry) {
    console.log(`\n--dry: the add_proposal args, unsigned:\n${JSON.stringify({ proposal }, null, 2)}`);
    return;
  }
  const member = signer();
  const result = await member.callFunctionRaw({
    contractId: dao,
    methodName: "add_proposal",
    args: { proposal },
    // Sputnik wants the bond exactly, and returns it when the proposal passes.
    deposit: BigInt(policy.proposal_bond),
    gas: 100n * TGAS,
  });
  const id = returned<number>(result);
  console.log(`\nproposed #${id} on ${dao} by ${member.accountId}: ${tx(result.transaction.hash)}`);
  console.log(`approve: npm run near:dao -- approve ${dao} ${id}`);
}

async function approve(dao: string, id: number) {
  const before = await view<Proposal>(dao, "get_proposal", { id });
  if (before.status !== "InProgress") {
    console.log(`#${id} is ${before.status}; nothing to vote on.`);
    return;
  }
  const member = signer();
  const result = await member.callFunctionRaw({
    contractId: dao,
    methodName: "act_proposal",
    // `proposal` must match what was proposed (v3 checks it; older DAOs ignore it),
    // so a vote can never be steered onto a proposal that was swapped underneath.
    args: { id, action: "VoteApprove", proposal: before.kind },
    gas: PAYOUT_EXECUTE_GAS,
  });
  const outcome = result as unknown as OutcomeLike;
  const after = await view<Proposal>(dao, "get_proposal", { id });
  console.log(`voted    yes on #${id} as ${member.accountId}: ${tx(result.transaction.hash)}`);
  console.log(`status   ${after.status}`);

  const holds = escrowEvents(outcome, config.escrowContract).filter((event) => event.event === "hold");
  for (const event of holds) {
    for (const item of event.data) console.log(`held     payment ${String(item.id)} ${JSON.stringify(item)}`);
  }
  const failure = firstFailure(outcome);
  if (failure) console.log(`failed   ${failure}`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2).filter((arg) => arg !== "--dry");
  const dry = process.argv.includes("--dry");
  if (command === "create" && rest[0]) return create(rest[0]);
  if (command === "propose" && rest[0] && rest[1]) return propose(rest[0], rest[1], dry);
  if (command === "approve" && rest[0] && /^\d+$/.test(rest[1] ?? "")) return approve(rest[0], Number(rest[1]));
  throw new Error(
    "Usage:\n  npm run near:dao -- create <name>\n  npm run near:dao -- propose <dao> <file.csv> [--dry]\n  npm run near:dao -- approve <dao> <id>",
  );
}

main().catch((error) => {
  console.error(error instanceof PayoutError ? `The payout file has problems:\n${error.message}` : `FAIL ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
