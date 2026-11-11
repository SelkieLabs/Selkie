-- What Selkie expects a NEAR account's USDC balance to be, in base units.
--
-- Selkie moves it every time it records money in or out of the account (a
-- send, a claim, a refund). Whatever the chain shows beyond it arrived from
-- outside Selkie (a faucet, an exchange, another wallet) and is written to the
-- feed once, so a balance never grows with no line saying why.
--
-- Null for accounts opened before this column existed, until first looked at.
alter table near_accounts add column seen_usdc numeric(40, 0);
