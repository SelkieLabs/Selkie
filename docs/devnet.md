# Selkie on Canton DevNet: the real cBTC reserve

Selkie's wallet ledger (accounts, balances, payments between handles) runs on
a Canton 3 LocalNet participant. On top of that, Selkie holds a **real cBTC
position on Canton DevNet**, on the shared HackCanton participant
(`hackcanton-01`), and proves it over HTTP.

```
GET /api/reserve
```

returns the live holdings, read from the DevNet participant's ledger at most
30 seconds ago. No login required: the point of a reserve is that anyone can
check it.

## How cBTC actually moves

cBTC (BitSafe) has no API of its own. Holdings are CIP-56 token-standard
contracts, and they move through two interfaces on the ordinary JSON Ledger
API v2:

- `TransferFactory_Transfer` starts a transfer
- `TransferInstruction_Accept` accepts an incoming one

Both choices need context the issuer computes off-ledger (the applicable
transfer rule, the instrument configuration, and disclosed contracts our
participant does not host). The issuer serves that context from the DA
Utility registry:

```
https://api.utilities.digitalasset-dev.com
  /api/token-standard/v0/registrars/<cbtc admin party>
  /registry/transfer-instruction/v1/...
```

So every transfer is two calls: fetch the choice context from the registry,
then exercise the choice on the ledger with that context attached verbatim.
`bot/src/cbtc.mjs` is the whole client, dependency-free.

## Operating the reserve

```sh
cd bot && source .env
node scripts/cbtc.mjs status            # holdings + pending transfers
node scripts/cbtc.mjs accept            # claim faucet transfers
node scripts/cbtc.mjs send <party> <n>  # real settlement to any DevNet party
```

Every accept and send prints the on-ledger `updateId`, which is the receipt:
the state change is visible in the party's ACS immediately after.

## Configuration

All-or-nothing by design; a half-configured reserve fails at boot instead of
quietly showing zero. Secrets live in the gitignored `.env` files only.

```sh
export SELKIE_CBTC_LEDGER=...     # participant JSON Ledger API v2 base URL
export SELKIE_CBTC_REGISTRY=...   # issuer registry base (DA Utility)
export SELKIE_CBTC_ADMIN=...      # instrument admin party (cbtc-network::...)
export SELKIE_CBTC_PARTY=...      # our party on the participant
export SELKIE_CBTC_TOKEN_URL=...  # Keycloak token endpoint
export SELKIE_CBTC_CLIENT_ID=...  # OIDC client (password grant)
export SELKIE_CBTC_USERNAME=...
export SELKIE_CBTC_PASSWORD=...

# cETH rides the same ledger, auth and registry host as cBTC, under its own
# registrar. Only the admin party differs; the rest is reused.
export SELKIE_CETH_ADMIN=...      # cETH instrument admin (rails-cethMain-1-dev::...)
export SELKIE_CETH_REGISTRY=...   # optional; defaults to SELKIE_CBTC_REGISTRY
```

Auth is a resource-owner-password grant against the validator's Keycloak;
the participant derives ledger rights from the token's `sub`, so the token
carries no claims worth forging.

## Getting the party id for token forms

```sh
node bot/scripts/address.mjs
```

Prints the party id and nothing else. It refuses to print a sandbox party:
a local party id looks identical to a real one, and tokens sent to a local
party are unrecoverable.

## What is still gated

Our user on the shared participant can act only as its own party. Uploading
the Selkie DAR to DevNet and allocating per-handle parties there needs the
node operator (participant admin rights). Until then, handle-to-handle
payments settle on LocalNet while the cBTC reserve is real on DevNet.
