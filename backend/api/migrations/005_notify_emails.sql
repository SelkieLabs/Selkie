-- An email address someone asked to be told at when money comes in.
--
-- Optional, one per person, and never used until they prove it is theirs with
-- a code sent to it: X sign-in gives Selkie no email, so this is the only
-- place one exists. Only a hash of the code is stored.
create table notify_emails (
  user_id         uuid primary key references users (id) on delete cascade,
  email           text not null,
  verified_at     timestamptz,
  code_hash       text,
  code_expires_at timestamptz,
  code_attempts   integer not null default 0,
  code_sent_at    timestamptz,
  created_at      timestamptz not null default now()
);
