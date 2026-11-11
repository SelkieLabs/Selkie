import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasContract } from "./chain";

const EMPTY = "11111111111111111111111111111111";

describe("hasContract", () => {
  it("says no for a plain account", () => {
    assert.equal(hasContract({ code_hash: EMPTY }), false);
    assert.equal(hasContract({ code_hash: EMPTY, global_contract_hash: null, global_contract_account_id: null }), false);
  });

  it("says yes for an account with its own contract", () => {
    // stakely_v2.pool.f863973.m0 on testnet, a staking pool.
    assert.equal(hasContract({ code_hash: "J1arLz48fgXcGyCPVckFwLnewNH6j1uw79thsvwqGYTY" }), true);
  });

  it("says yes for an account using a global contract, whose own code hash is empty", () => {
    assert.equal(hasContract({ code_hash: EMPTY, global_contract_hash: "8Lq6ZkFpY1uBX8ZiD5fYmvKxQa4bQ1vJ3oHc7GZ9u2mN" }), true);
    assert.equal(hasContract({ code_hash: EMPTY, global_contract_account_id: "contracts.near" }), true);
  });
});
