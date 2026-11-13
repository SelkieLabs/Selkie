-- NEAR mode: the follow-up to a tweeted send the bot answered with a link.
--
-- When the bot cannot pay from a pocket it replies with a link, and the person
-- signs the payment in Selkie. These columns remember what that link was for,
-- so the payment it leads to can be announced back in the same thread
-- ("2 USDC is waiting for @amaka"), which is how the person paid finds out.
alter table near_bot_sends
  add column link_to        text,
  -- USDC base units, so "2" and "2.00" are the same payment.
  add column link_units     text,
  -- What to announce, as JSON, once the linked payment lands. Null until then.
  add column follow_up      text,
  add column followed_up_at timestamptz;

create index near_bot_sends_open_links
  on near_bot_sends (sender_x_user_id, link_to)
  where link_to is not null and follow_up is null;
