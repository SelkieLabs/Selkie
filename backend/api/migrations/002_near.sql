-- NEAR mode (SELKIE_CHAIN=near). Runs against NEAR's own database; on a Stellar
-- database these tables simply stay empty.

-- Which NEAR account an X user owns. Keyed on the X user id, not the username:
-- the account name is chosen once, from the handle at first sign-in, and the
-- person keeps it if they rename on X.
create table near_accounts (
  x_user_id  text primary key,
  account_id text not null unique,
  -- The user's own key, read from their Privy wallet. Never a key of ours.
  public_key text not null,
  created_at timestamptz not null default now()
);

-- What a user was asked to sign. The relayer submits a signed delegate only if
-- it matches one of these byte for byte, and only once.
create table near_prepares (
  id         uuid primary key,
  user_id    uuid not null references users (id) on delete cascade,
  -- Kept as text, not jsonb: jsonb reorders keys, and the signature covers bytes.
  delegate   text not null,
  -- What the payment means to Selkie (who, how much), for the feed.
  intent     text not null,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create index near_prepares_user on near_prepares (user_id, created_at desc);
