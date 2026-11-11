import assert from "node:assert/strict";
import { test } from "node:test";
import { PayoutError, parsePayoutCsv, payoutProposal, proposalTotal } from "./dao";
import { fromBase64 } from "./delegate";
import { MAX_HOLD_MANY_ITEMS } from "./escrow";

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

test("a payout file: header, comments and blank lines skipped, handles lowercased", () => {
  const rows = parsePayoutCsv("handle,amount\n# march contributors\n@Amaka,5\n\ntunde_9, 2.50 \n");
  assert.deepEqual(
    rows.map(({ handle, units, line }) => ({ handle, units, line })),
    [
      { handle: "amaka", units: 5_000_000n, line: 3 },
      { handle: "tunde_9", units: 2_500_000n, line: 5 },
    ],
  );
});

test("every problem in the file is reported at once, with its line", () => {
  assert.throws(
    () => parsePayoutCsv("@amaka,5\n@not a handle,1\n@bo,abc\n@ci,0.001\n@amaka,2\n@di,1,extra"),
    (error: unknown) => {
      assert.ok(error instanceof PayoutError);
      const lines = error.message.split("\n");
      assert.equal(lines.length, 5);
      assert.match(lines[0]!, /^line 2: .*not an X handle/);
      assert.match(lines[1]!, /^line 3: @bo:/);
      assert.match(lines[2]!, /^line 4: @ci gets 0.001; the escrow holds at least 0.01 USDC/);
      assert.match(lines[3]!, /^line 5: @amaka is already on line 1/);
      assert.match(lines[4]!, /^line 6: expected "@handle,amount"/);
      return true;
    },
  );
});

test("an empty file and a file too big for one proposal are refused", () => {
  assert.throws(() => parsePayoutCsv("handle,amount\n# nobody yet\n"), /nobody to pay/);
  const many = Array.from({ length: MAX_HOLD_MANY_ITEMS + 1 }, (_, i) => `@p${i},1`).join("\n");
  assert.throws(() => parsePayoutCsv(many), /one proposal pays at most 40/);
});

test("the proposal is one ft_transfer_call to the escrow with a hold_many per person", () => {
  const proposal = payoutProposal({
    usdc: "usdc.test",
    escrow: "escrow.test",
    people: [
      { handle: "amaka", units: 5_000_000n, recipient: KEY_A },
      { handle: "tunde", units: 2_500_000n, recipient: KEY_B },
    ],
    lifetimeSecs: 30 * 86_400,
  });

  const call = proposal.kind.FunctionCall;
  assert.equal(call.receiver_id, "usdc.test");
  assert.equal(call.actions.length, 1);
  const [action] = call.actions;
  assert.equal(action!.method_name, "ft_transfer_call");
  // NEP-141 wants exactly one yocto; Sputnik wants numbers as strings.
  assert.equal(action!.deposit, "1");
  assert.equal(action!.gas, "300000000000000");

  const args = JSON.parse(new TextDecoder().decode(fromBase64(action!.args)));
  assert.equal(args.receiver_id, "escrow.test");
  assert.equal(args.amount, "7500000");
  assert.deepEqual(JSON.parse(args.msg), {
    kind: "hold_many",
    lifetime_secs: 2_592_000,
    items: [
      { recipient: KEY_A, amount: "5000000" },
      { recipient: KEY_B, amount: "2500000" },
    ],
  });
  assert.equal(proposalTotal(proposal), 7_500_000n);
  assert.match(proposal.description, /7\.5 USDC in all: @amaka 5, @tunde 2\.5\./);
  assert.match(proposal.description, /after 30 days, the DAO can take it back/);
});

test("a proposal with nobody in it is refused", () => {
  assert.throws(
    () => payoutProposal({ usdc: "u", escrow: "e", people: [], lifetimeSecs: 60 }),
    PayoutError,
  );
});
