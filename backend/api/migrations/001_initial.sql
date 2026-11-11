-- Selkie's first schema.
--
-- The point of moving off a file is not that a database is faster. It is that
-- the rules the product depends on stop being promises made by TypeScript and
-- become things the storage engine will not let you break, at three in the
-- morning, under load, from whichever server happens to handle the request.
--
-- So the constraints here are not decoration. Each one is a way somebody's
-- money goes missing, written down.

-- One person. One wallet. Many ways of signing in.
create table users (
  id         uuid primary key,
  -- Unique because two people sharing a wallet address is not a state Selkie
  -- has any meaning for: it would show each of them the other's balance.
  address    text not null unique,
  created_at timestamptz not null default now()
);

-- The doors somebody can arrive through, and the handles they can be paid at.
create table identities (
  provider     text not null check (provider in ('google', 'x', 'telegram')),
  -- The provider's permanent id, never the @handle. Handles get renamed and
  -- re-registered; keying on the string would eventually hand one person's
  -- money to a stranger.
  subject      text not null,
  user_id      uuid not null references users (id) on delete cascade,
  username     text,
  display_name text,
  avatar_url   text,
  email        text,
  -- What the provider actually vouched for. Only a login may create an account
  -- or attach a handle, because attaching a handle releases escrowed money.
  attestation  text not null check (attestation in ('login', 'authorship')),
  linked_at    timestamptz not null default now(),
  -- This is the constraint that holds the account model up: an identity belongs
  -- to exactly one user. Without it, "sign in with X" could quietly attach the
  -- same X account to a second wallet and split someone's money in two.
  primary key (provider, subject)
);

create index identities_by_user on identities (user_id);

-- Routing a payment to a handle. Deliberately NOT unique: an X handle can be
-- released and taken by somebody else, so two rows may claim the same name
-- while the older one is stale. Reads resolve that by preferring the identity
-- proven most recently, which a unique index would instead turn into a crash on
-- the day someone renames.
create index identities_by_handle on identities (provider, lower(username))
  where username is not null;

-- Which handle owns which account on the ledger.
--
-- Product state, not chain state: the ledger knows addresses, it does not know
-- that @amaka owns one. Losing this table does not lose the money, it loses the
-- ability to ever find it again.
create table accounts (
  platform    text not null check (platform in ('x', 'telegram')),
  -- Stored folded to lower case. @Amaka and @amaka are one X account, and a
  -- directory that disagrees would provision a second wallet for the same
  -- person the first time somebody typed their name with a capital letter.
  username    text not null check (username = lower(username)),
  address     text not null,
  -- False until the account exists on the ledger. Until then the wallet is a
  -- promise, and an address we must not hand to anybody.
  provisioned boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (platform, username)
);

-- Not unique: linking a second handle points it at the wallet the person
-- already has, which is the entire reason linking exists.
create index accounts_by_address on accounts (address);

-- The keys to those accounts.
--
-- Encrypted here, and never written anywhere else. A database dump, a backup, a
-- replica, or a support engineer's laptop must not be a pile of spendable keys,
-- and "the column is called secret" is not a control. The version says which
-- master key sealed it, so keys can be rotated without a flag day.
create table wallet_keys (
  address     text primary key,
  ciphertext  bytea not null,
  iv          bytea not null,
  auth_tag    bytea not null,
  key_version integer not null,
  created_at  timestamptz not null default now()
);

-- What someone did with their money, described the way they would describe it.
create table activity (
  -- Two columns for one thing, on purpose. `seq` is what the feed is ordered by
  -- and `id` is what the API says out loud. Ordering by the text id would be
  -- wrong the moment there are ten entries: 'act_9' sorts after 'act_10', so a
  -- tie on the timestamp would put the older payment on top.
  seq                   bigint primary key generated always as identity,
  id                    text not null unique generated always as ('act_' || seq) stored,
  user_id               uuid not null references users (id) on delete cascade,
  kind                  text not null
                          check (kind in ('send', 'receive', 'claim', 'airtime', 'bill', 'swap', 'cashout')),
  chain                 text not null,
  -- numeric, never a float. A balance that has been through a double has
  -- already lost the argument, and no amount of formatting gets it back.
  amount_value          numeric not null check (amount_value >= 0),
  amount_asset          text not null,
  counterparty          text,
  -- The other side as a handle, when it was one. "@amaka" alone cannot be paid
  -- again: @amaka on X is a different person from @amaka on Telegram.
  counterparty_platform text,
  counterparty_username text,
  status                text not null check (status in ('pending', 'confirmed', 'failed', 'returned')),
  at                    timestamptz not null default now(),
  -- The transaction that did it.
  ref                   text,
  -- The escrow's own id for money still waiting on a handle. Distinct from ref:
  -- taking a payment back needs the id of the payment, not of the transaction.
  claim_ref             text,
  refundable_at         timestamptz
);

-- The feed, exactly as it is read: one person's entries, newest first. `seq`
-- breaks ties, because two payments in the same instant are otherwise returned
-- in whatever order the planner felt like, and a feed that reshuffles itself
-- between refreshes looks like money moving around.
create index activity_feed on activity (user_id, at desc, seq desc);

-- Settling the sender's side of a payment the escrow just released.
create index activity_by_claim_ref on activity (claim_ref) where claim_ref is not null;

-- Asking someone for money.
--
-- Addressed to a HANDLE rather than to a user, because the person being asked
-- may not have joined yet. A request moves nothing by itself; only the person
-- it names can turn it into a payment.
create table money_requests (
  seq           bigint primary key generated always as identity,
  id            text not null unique generated always as ('req_' || seq) stored,
  from_user_id  uuid not null references users (id) on delete cascade,
  from_platform text not null,
  from_username text not null,
  to_platform   text not null,
  to_username   text not null,
  amount_value  numeric not null check (amount_value > 0),
  amount_asset  text not null,
  note          text,
  status        text not null check (status in ('pending', 'paid', 'declined', 'cancelled')),
  created_at    timestamptz not null default now(),
  settled_at    timestamptz,
  ref           text,
  -- A settled request has to say when. Without this, "paid" with no timestamp
  -- is a row that no screen can render honestly.
  constraint settled_requests_have_a_time
    check (status = 'pending' or settled_at is not null)
);

create index requests_addressed_to on money_requests (to_platform, lower(to_username));
create index requests_sent_by on money_requests (from_user_id);

-- Making a money route safe to call twice.
--
-- The in-memory version of this only guarded one server. Two of them behind a
-- load balancer each kept their own copy, so a retry that landed on the other
-- one was not a retry at all: it was a second, real payment. The primary key
-- below is what makes the claim atomic no matter how many servers there are.
create table idempotency (
  -- No foreign key on purpose. This table is swept by age rather than owned by
  -- a user, and a payment's guard should not disappear underneath it because an
  -- account was being merged at that moment.
  user_id      uuid not null,
  key          text not null,
  -- What was asked for the first time this key was used. A key that stands for
  -- one payment must never be answered with another's receipt.
  fingerprint  text not null,
  status       integer,
  body         jsonb,
  claimed_at   timestamptz not null default now(),
  completed_at timestamptz,
  primary key (user_id, key)
);

-- For the sweep. Only ever scanned by age.
create index idempotency_by_age on idempotency (claimed_at);
