# Vote reminder draft — not deployed or enabled

`VoteReminders.gs` belongs beside `Code.gs` in the bound Apps Script project. It is local source only: no live trigger, no actual vote and no production reminder has been created.

## Status and schedule

- `getClientVoteStatus_({voterId, voterEmail})` returns `hasVoted` and `votedAt` for the authenticated voter, without exposing their selection. The Worker must inject these fields from the signed Jira session, never trust browser-supplied identities.
- `getReminderVoteStatus_()` returns the admin roster with `hasVoted`, `votedAt`, pending/voted counts and missing Chat IDs. Matching uses normalized voter email first, then stable candidate/Chat IDs; unresolved legacy identities block sending to prevent false mentions.
- `saveVoteReminder_({sendAt})` accepts an ISO timestamp including timezone, e.g. a browser date input converted with `new Date(value).toISOString()`. It must be in the future and before the activity deadline. Each schedule belongs to the current `activityId`; duplicate times are rejected.
- `cancelVoteReminder_({id})` cancels pending/partial jobs. `listVoteReminders_()` provides schedule/delivery status plus voter status.
- No activity, closed/ended voting, another activity ID, disabled reminders, late jobs (over ten minutes), unresolved voter IDs and absent active Chat IDs never produce inappropriate mentions. Client names alone cannot produce a mention: a canonical `users/123` ID from the active room roster is required.

## Integrate later, not yet wired

Add signed actions for these functions inside `Code.gs`'s existing HMAC-verified `doPost`. Add matching Worker endpoints that enforce the existing signed Jira session: voter status may expose ONLY that voter's status; roster/list/save/cancel require `user.admin`, and all mutations require exact same-origin validation. Never expose them through public `doGet` or `/api/data`.

Add the admin schedule UI only when requested. Store the selected environment's webhook in **Apps Script Script Properties** as `GOOGLE_CHAT_WEBHOOK_URL` before activating: the current Sites secret is not automatically available to time-trigger executions. Do not paste either webhook into source, HTML or logs. The module checks `VOTING_ENV` plus `CHAT_SPACE_ID`: test permits only `AAQA0MkG6JM`; production permits only `AAQASHHP1Y4`. A webhook pointing at the other environment is rejected before transmission.

Only call `startRealVoteReminders()` when production sending is explicitly requested. It installs a one-minute Apps Script trigger and enables real sends. `stopRealVoteReminders()` disables it and removes only that handler's triggers. Apps Script time triggers are approximate, not an exact-second scheduler. Existing Apps Script permissions may need fresh authorization for UrlFetchApp/ScriptApp; this draft does not grant them.

## Delivery safety

The tick reads fresh committed votes under the SAME ScriptLock used by `recordVote_`, immediately before each send. A vote recorded after scheduling is excluded. At most 40 pending active members are mentioned per batch; later ticks re-read status and omit already mentioned IDs. Google Chat mentions use `<users/ID>`.

Delivery states: `pending`, `partial`, `sending`, `sent`, `cancelled`, `skipped`, `blocked`, `failed`, `unknown`. The `VoteReminders` sheet records attempt times, mentioned IDs and Chat message receipts without storing the webhook. Marking `sending` is flushed before transmission. Timeout, server error, missing receipt or a crash leaves `unknown` and is NOT retried automatically (avoids accidental duplicates when Google accepted a message but the response was lost). Review unknown/blocked jobs manually; no exactly-once delivery guarantee is claimed.

Current Votes has only four columns and the website supports one current activity. Legacy rows therefore belong to that current activity. Before adding multiple activities, backfill a fifth `activityId` column, persist it on every new vote, and scope duplicate-vote detection/results/status to that ID. Do not reuse old rows as new-activity voter status.

## Tests

`node test-vote-reminders.mjs` uses fully mocked Sheets, time, locks and transport. Covers live-status lookup, votes added after scheduling, duplicate schedule/send protection, cancellation, disabled/late jobs, identity failures and ambiguous delivery. No real webhook call occurs in this suite.

`test-chat-room.mjs` is a separate, manually invoked diagnostic restricted to test room `AAQA0MkG6JM`. It reads credentials from hidden stdin, validates membership again before tagging and cannot send to the production room. One explicitly authorized test message was sent tagging only Chawapon, a verified test-room member. It does not install reminders, alter the voting sheet, or assert that any real person has/hasn't voted.

References: [Google Chat webhook guide](https://developers.google.com/workspace/chat/quickstart/webhooks), [Chat message formatting](https://developers.google.com/workspace/chat/format-messages), [Apps Script installable triggers](https://developers.google.com/apps-script/guides/triggers/installable).
