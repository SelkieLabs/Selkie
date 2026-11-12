import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { endpointUnavailable, failoverProvider, rpcUrls } from "./rpc";

const ACCOUNT = {
  amount: "1000",
  locked: "0",
  code_hash: "11111111111111111111111111111111",
  storage_usage: 100,
  storage_paid_at: 0,
  block_height: 1,
  block_hash: "11111111111111111111111111111111",
};

/** A fake RPC: `mode` decides how it answers. Counts the calls it got. */
function fakeRpc(mode: "limited" | "ok" | "missing") {
  const state = { calls: 0, server: null as Server | null, url: "" };
  state.server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      state.calls += 1;
      const { id } = JSON.parse(body) as { id: number };
      if (mode === "limited") {
        res.writeHead(429).end("Too Many Requests");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          mode === "ok"
            ? { jsonrpc: "2.0", id, result: ACCOUNT }
            : {
                jsonrpc: "2.0",
                id,
                error: {
                  name: "HANDLER_ERROR",
                  cause: { name: "UNKNOWN_ACCOUNT", info: { requested_account_id: "nobody.testnet" } },
                  code: -32000,
                  message: "Server error",
                  data: "account nobody.testnet does not exist while viewing",
                },
              },
        ),
      );
    });
  });
  return state;
}

async function listen(state: ReturnType<typeof fakeRpc>) {
  await new Promise<void>((resolve) => state.server!.listen(0, "127.0.0.1", resolve));
  state.url = `http://127.0.0.1:${(state.server!.address() as AddressInfo).port}`;
}

describe("rpcUrls", () => {
  it("splits a comma list and drops blanks", () => {
    assert.deepEqual(rpcUrls(" https://a , https://b,,"), ["https://a", "https://b"]);
    assert.deepEqual(rpcUrls("https://only"), ["https://only"]);
  });
});

describe("endpointUnavailable", () => {
  it("is true for rate limits, 5xx and no answer", () => {
    assert.equal(endpointUnavailable({ cause: 429, message: "deprecated" }), true);
    assert.equal(endpointUnavailable({ cause: 503 }), true);
    assert.equal(endpointUnavailable(new TypeError("fetch failed")), true);
  });
  it("is false for answers", () => {
    assert.equal(endpointUnavailable(new Error("account nobody.testnet does not exist while viewing")), false);
    assert.equal(endpointUnavailable({ cause: -1, message: "Server error" }), false);
  });
});

describe("failoverProvider", () => {
  const limited = fakeRpc("limited");
  const ok = fakeRpc("ok");
  const missing = fakeRpc("missing");
  before(async () => {
    await Promise.all([listen(limited), listen(ok), listen(missing)]);
  });
  after(() => {
    for (const s of [limited, ok, missing]) s.server!.close();
  });

  it("moves to the next endpoint when one is rate-limited, and stays there", async () => {
    const provider = failoverProvider([limited.url, ok.url]);
    const view = await provider.viewAccount({ accountId: "someone.testnet" });
    assert.equal(String(view.amount), "1000");
    const before = limited.calls;
    await provider.viewAccount({ accountId: "someone.testnet" });
    assert.equal(limited.calls, before, "the second call went straight to the working endpoint");
  });

  it("never retries a real answer elsewhere", async () => {
    const okCalls = ok.calls;
    const provider = failoverProvider([missing.url, ok.url]);
    await assert.rejects(provider.viewAccount({ accountId: "nobody.testnet" }), /does not exist/);
    assert.equal(ok.calls, okCalls);
  });

  it("gives up with the last endpoint's error when all are down", async () => {
    const provider = failoverProvider([limited.url, limited.url]);
    await assert.rejects(provider.viewAccount({ accountId: "someone.testnet" }), /Too Many Requests/);
  });
});
