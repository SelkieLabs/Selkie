import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MIN_BOT_SECRET_LENGTH } from "@selkie/core";
import { loadBotConfig } from "./config";

const BASE = {
  SELKIE_BOT_SECRET: "s".repeat(MIN_BOT_SECRET_LENGTH),
  X_API_KEY: "k",
  X_API_SECRET: "ks",
  X_ACCESS_TOKEN: "t",
  X_ACCESS_SECRET: "ts",
} as NodeJS.ProcessEnv;

const load = (extra: NodeJS.ProcessEnv = {}) => loadBotConfig({ ...BASE, ...extra });

describe("how often it looks", () => {
  it("takes the interval it is given", () => {
    assert.equal(load({ X_POLL_SECONDS: "15" }).x?.pollMs, 15_000);
  });

  it("will not go below the floor, because faster than the quota is slower", () => {
    assert.equal(load({ X_POLL_SECONDS: "2" }).x?.pollMs, 15_000);
  });

  it("falls back rather than becoming NaN on nonsense", () => {
    // NaN sails straight through a Math.max floor, and setTimeout(NaN) fires
    // at once: the wait between polls becomes no wait, against a metered API.
    for (const value of ["", "abc", "-5", "0"]) {
      const pollMs = load({ X_POLL_SECONDS: value }).x?.pollMs;
      assert.ok(Number.isFinite(pollMs), `${value} gave ${pollMs}`);
      assert.ok((pollMs ?? 0) >= 15_000, `${value} gave ${pollMs}`);
    }
  });
});

describe("which surfaces start", () => {
  it("runs no X surface when it has no X credentials", () => {
    assert.equal(loadBotConfig({ SELKIE_BOT_SECRET: BASE.SELKIE_BOT_SECRET }).x, undefined);
  });

  it("refuses a half-configured X rather than failing later with a 401", () => {
    assert.throws(() => loadBotConfig({ ...BASE, X_ACCESS_SECRET: undefined }), /half configured/);
  });

  it("will not start without a secret it can prove itself with", () => {
    assert.throws(() => loadBotConfig({ ...BASE, SELKIE_BOT_SECRET: undefined }));
  });

  it("will not start with a secret short enough to guess", () => {
    assert.throws(() => loadBotConfig({ ...BASE, SELKIE_BOT_SECRET: "short" }));
  });
});

describe("posting for real", () => {
  it("stays in dry run unless explicitly turned off", () => {
    assert.equal(load().dryRun, true);
    assert.equal(load({ SELKIE_BOT_DRY_RUN: "1" }).dryRun, true);
    assert.equal(load({ SELKIE_BOT_DRY_RUN: "yes" }).dryRun, true);
  });

  it("posts when told to, in either spelling", () => {
    assert.equal(load({ SELKIE_BOT_DRY_RUN: "0" }).dryRun, false);
    assert.equal(load({ SELKIE_BOT_DRY_RUN: "false" }).dryRun, false);
  });
});
