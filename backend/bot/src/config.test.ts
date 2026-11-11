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
  it("comes ready to answer quickly without being configured to", () => {
    // The default matters more than the setting. Nobody tunes a bot before
    // finding out whether it is any good.
    const x = load().x;
    assert.equal(x?.activeMs, 3_000, "as fast as a healthy quota allows");
    assert.equal(x?.pollMs, 15_000, "and no slower than this when X says nothing");
  });

  it("takes the intervals it is given", () => {
    const x = load({ X_POLL_SECONDS: "30", X_ACTIVE_POLL_SECONDS: "8" }).x;
    assert.equal(x?.pollMs, 30_000);
    assert.equal(x?.activeMs, 8_000);
  });

  it("will not let the floor sit above the ceiling", () => {
    // Configured that way round the clamp between them has no room to work in.
    const x = load({ X_POLL_SECONDS: "10", X_ACTIVE_POLL_SECONDS: "45" }).x;
    assert.ok((x?.activeMs ?? 0) <= (x?.pollMs ?? 0), `${x?.activeMs} vs ${x?.pollMs}`);
  });

  it("keeps a floor under both, as a guard rather than a policy", () => {
    // How fast it really polls is worked out at runtime from the quota X
    // reports. This only stops a stray value becoming a tight loop.
    const x = load({ X_POLL_SECONDS: "1", X_ACTIVE_POLL_SECONDS: "0.1" }).x;
    assert.ok((x?.pollMs ?? 0) >= 5_000);
    assert.ok((x?.activeMs ?? 0) >= 2_000);
  });

  it("falls back rather than becoming NaN on nonsense", () => {
    // NaN sails straight through a Math.max floor, and setTimeout(NaN) fires
    // at once: the wait between polls becomes no wait, against a metered API.
    for (const value of ["", "abc", "-5", "0"]) {
      const x = load({ X_POLL_SECONDS: value, X_ACTIVE_POLL_SECONDS: value }).x;
      assert.ok(Number.isFinite(x?.pollMs), `X_POLL_SECONDS=${value} gave ${x?.pollMs}`);
      assert.ok(Number.isFinite(x?.activeMs), `X_ACTIVE_POLL_SECONDS=${value} gave ${x?.activeMs}`);
      assert.ok((x?.activeMs ?? 0) > 0);
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
