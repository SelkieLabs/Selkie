import assert from "node:assert/strict";
import { test } from "node:test";
import { Asset } from "@stellar/stellar-sdk";
import { AssetRegistry, NATIVE_ASSET, UnknownAssetError, type AssetDef } from "./assets";

const USDC: AssetDef = {
  code: "USDC",
  issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  label: "US Dollar Coin",
  stable: true,
};

const registry = () => new AssetRegistry([USDC, NATIVE_ASSET]);

test("looks assets up regardless of how the user typed the code", () => {
  const assets = registry();
  assert.equal(assets.get("usdc").issuer, USDC.issuer);
  assert.equal(assets.get(" USDC ").issuer, USDC.issuer);
  assert.equal(assets.get("XLM").code, "XLM");
});

test("refuses assets that are not on the allowlist", () => {
  // The escrow contract is token-agnostic, so anyone can lock a token they
  // minted themselves against a handle. Refusing here is what stops a scam
  // token from ever showing up as a balance.
  const assets = registry();
  assert.throws(() => assets.get("SCAMCOIN"), UnknownAssetError);
  assert.equal(assets.has("SCAMCOIN"), false);
});

test("builds the right chain asset, native included", () => {
  const assets = registry();
  const usdc = assets.toStellarAsset("USDC");
  assert.equal(usdc.getCode(), "USDC");
  assert.equal(usdc.getIssuer(), USDC.issuer);
  assert.equal(assets.toStellarAsset("XLM").isNative(), true);
});

test("recognizes assets coming back off the ledger", () => {
  const assets = registry();
  assert.equal(assets.fromStellarAsset(Asset.native())?.code, "XLM");
  assert.equal(assets.fromStellarAsset(new Asset("USDC", USDC.issuer!))?.code, "USDC");
});

test("does not recognize a lookalike from a different issuer", () => {
  // Same code, impostor issuer. This is the realistic attack: a fake "USDC"
  // that would look identical in a balance list.
  const assets = registry();
  const fake = new Asset("USDC", "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN");
  assert.equal(assets.fromStellarAsset(fake), undefined);
});
