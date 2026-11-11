-- Browsers that asked to be told when money comes in (Web Push).
--
-- One row per browser, keyed by the push service's endpoint URL for it. The
-- keys encrypt each message to that browser, so the push service (Google,
-- Mozilla, Apple, Microsoft) carries it without being able to read it.
create table push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references users (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create index push_subscriptions_user on push_subscriptions (user_id, created_at desc);
