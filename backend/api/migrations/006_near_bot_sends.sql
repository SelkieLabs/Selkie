-- NEAR mode: sends the X bot made from somebody's pocket because they tweeted.
--
-- One row per tweet, claimed before anything moves. The bot can read the same
-- mention twice (a restart, an overlapping poll); the second read gets the
-- first answer back from here, never a second payment. A row left with no
-- result (the process died mid-send) stays claimed, for the same reason.
create table near_bot_sends (
  tweet_id         text primary key,
  sender_x_user_id text not null,
  -- The answer the bot was given, as JSON. Null while the first attempt runs.
  result           text,
  created_at       timestamptz not null default now(),
  finished_at      timestamptz
);
