# apps/bot

The X and Telegram surfaces. Thin: they parse a message ("send @amaka 5"), call the same `@selkie/core` flow the web app uses, and reply with a confirmation. No chain code, no business logic that the web app does not also share.

Being ported from the Canton build's `bot/`, keeping the message parsing and platform plumbing and swapping the ledger client for `@selkie/core` + `@selkie/chain-stellar`.

Privacy rule: airtime, bills, and anything with a phone or meter number run over DM only, never on the public timeline. The public reply just confirms it is done.
