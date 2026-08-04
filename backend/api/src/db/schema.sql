-- Selkie's tables.
--
-- Applied on every boot; every statement is IF NOT EXISTS, so starting the API
-- against an existing database is a no-op and starting it against an empty one
-- is the whole setup step.
--
-- Money is stored as TEXT, never as a number. SQLite's REAL is a float, and a
-- float is how you end up owing somebody 4.999999999 dollars.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  address    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- One person is one user with a LIST of identities. The primary key is the
-- rule, not a formality: an identity belonging to exactly one account is what
-- stops one person from ending up with two wallets, and leaving that to
-- application code means one missed check away from losing somebody's money.
CREATE TABLE IF NOT EXISTS identities (
  provider     TEXT NOT NULL,
  -- The provider's permanent id, never the @handle: handles get renamed and
  -- re-registered, and keying on the string would eventually hand someone
  -- else's money to a stranger.
  subject      TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username     TEXT,
  display_name TEXT,
  avatar_url   TEXT,
  email        TEXT,
  linked_at    TEXT NOT NULL,
  PRIMARY KEY (provider, subject)
);

CREATE INDEX IF NOT EXISTS identities_user ON identities (user_id);
-- Routing a payment to a handle is case-insensitive, so the index has to be too.
CREATE INDEX IF NOT EXISTS identities_handle
  ON identities (provider, lower(username));

-- The identity provider's own id for a person, proved from their token's
-- signature alone. This is the fast lane: every authenticated request lands
-- here instead of asking the provider who somebody is.
--
-- Many-to-one on purpose. Someone who signed up twice and then merged has two
-- provider accounts and one wallet, and both logins have to keep working.
CREATE TABLE IF NOT EXISTS provider_accounts (
  subject TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS provider_accounts_user ON provider_accounts (user_id);

-- sha256("<platform>:<username>") -> the handle it came from.
--
-- The chain only ever sees the hash, and a hash cannot be reversed, so watching
-- for money arriving means keeping this. Written whenever a handle becomes known
-- to Selkie; it is not secret, since anyone can hash a handle they already know.
CREATE TABLE IF NOT EXISTS handle_index (
  handle_hash TEXT PRIMARY KEY,
  platform    TEXT NOT NULL,
  username    TEXT NOT NULL
);

-- How far a background reader has got. One row per reader, so a restart
-- resumes instead of replaying the whole ledger or skipping what it missed.
CREATE TABLE IF NOT EXISTS cursors (
  name  TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL,
  kind                  TEXT NOT NULL,
  chain                 TEXT NOT NULL,
  amount                TEXT NOT NULL,
  asset                 TEXT NOT NULL,
  counterparty          TEXT,
  counterparty_platform TEXT,
  counterparty_username TEXT,
  status                TEXT NOT NULL,
  at                    TEXT NOT NULL,
  ref                   TEXT,
  -- The escrow's id for money still waiting. Only rows with one can be
  -- refunded, and it is how a claim finds the sender's side of the story.
  claim_ref             TEXT,
  refundable_at         TEXT
);

CREATE INDEX IF NOT EXISTS activity_feed ON activity (user_id, at DESC);
CREATE INDEX IF NOT EXISTS activity_claim ON activity (claim_ref);

-- A request is addressed to a HANDLE, not a user id: the person being asked may
-- not have joined yet, and the request should be waiting when they do.
CREATE TABLE IF NOT EXISTS requests (
  id            TEXT PRIMARY KEY,
  from_user_id  TEXT NOT NULL,
  from_platform TEXT NOT NULL,
  from_username TEXT NOT NULL,
  to_platform   TEXT NOT NULL,
  to_username   TEXT NOT NULL,
  amount        TEXT NOT NULL,
  asset         TEXT NOT NULL,
  note          TEXT,
  status        TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  settled_at    TEXT,
  ref           TEXT
);

CREATE INDEX IF NOT EXISTS requests_sender ON requests (from_user_id);
CREATE INDEX IF NOT EXISTS requests_target ON requests (to_platform, to_username);

-- Which handle owns which Stellar address. Product state, not chain state: the
-- ledger knows addresses, it does not know that @amaka owns one.
CREATE TABLE IF NOT EXISTS accounts (
  platform    TEXT NOT NULL,
  username    TEXT NOT NULL,
  address     TEXT NOT NULL,
  provisioned INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (platform, username)
);

CREATE INDEX IF NOT EXISTS accounts_address ON accounts (address);

-- Answers already given, so a retry of a payment gets the first answer back
-- instead of sending the money again. A row with a null body is work in flight.
CREATE TABLE IF NOT EXISTS idempotency (
  user_id TEXT NOT NULL,
  key     TEXT NOT NULL,
  status  INTEGER,
  body    TEXT,
  at      TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
