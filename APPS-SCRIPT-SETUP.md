# Google Sheet backend setup

## Multi-activity release (7 October 2026)

The deployed editor contains Code.gs, Activities.gs and VoteReminders.gs. Upload together or as separate script files before deploying the same Web app URL. Reminders additionally require `script.scriptapp` authorization for the one-minute clock trigger.

- Signed `action: app` operations store Activities, ActivityVotes and Roles in additive new tabs. The first read migrates the original activity/votes idempotently; original Config, Votes and Results tabs are preserved.
- Candidate/electorate snapshots use the latest Client/Chat list at creation. Each activity has separate ballots, deadline and awards. Refreshing a closed activity never reopens it.
- Admin and Subadmin cannot vote unless that activity's allowAdminVote checkbox is enabled. Eligible roster still uses the activity snapshot; admins outside that roster are not added automatically. Self-votes match canonical ID or email, not display name. Every write checks current stored role under ScriptLock; browser/cookie role flags are not authority.
- Activities append startAt and allowAdminVote columns without deleting or changing existing ballots. Missing start time means start immediately; legacy admin voting defaults false. Future-start activities remain scheduled and reject early ballots server-side. Reads and the existing minute clock activate them at start; the open-state reconciliation continues even while Chat reminders are paused. Closed activities never reopen; start time cannot change after the first ballot. Reminder times must not precede opening.
- A final eligible ballot closes immediately. Deadline closure is reconciled on reads/writes and reminder ticks. The reminder clock checks approximately every minute while enabled, including with the browser closed.
- Own ballot and history are returned only for the server-authenticated actor. Public activity records exclude electorate emails and voter identities.
- Results are counted on each read. Equal scores share competition ranks (1,1,3); zero votes do not claim a winning award.
- Root admins manage Subadmin roles; Subadmin may create/edit/close activities, announce and sync Chat but cannot change roles. No person was promoted during deployment/testing.
- Vote links include the immutable activity ID, and Jira login preserves that destination. Announcement deduplication is separate per activity and preserves legacy receipts.

Run `node test-activities.mjs`, `node test-reminders.mjs` and the existing transport-mocked suites. All webhook calls in tests are mocked. Admin/Subadmin can enable/pause the reminder engine and add/cancel several one-time reminders per open activity. Queues are stored in VoteReminders. The sender reads ActivityVotes under the ballot lock immediately before each batch, excludes admins, self-containedly handles separate activities, and matches eligible users to currently active ChatMembers. Reminders tag only non-voters, not @all. Closed/stale/wrong-environment queues are skipped; uncertain delivery is never retried automatically. Webhook secrets stay in server-side Script Properties and are never returned to the browser. Old unbound draft rows are skipped, not replayed.

1. Open the voting Google Sheet.
2. Choose **Extensions → Apps Script**.
3. Replace the default code with the contents of `Code.gs`.
4. Save, then run `setup` once and authorize it.
5. Choose **Deploy → New deployment → Web app**.
6. Set **Execute as: Me** and **Who has access: Anyone**.
7. Copy the Web app URL; the website will use it for `GET ?action=config`, `GET ?action=results`, and `POST` actions `vote` / `saveConfig`.

Each voter must send a stable `voterId` (the Jira account ID). The script rejects a second vote from the same ID.

## Google Chat member sync

## Manual vote announcement and time display

- Dates display `dd MMMM yyyy · HH:mm` using Thai full month names, Gregorian years and Asia/Bangkok (UTC+07:00), without seconds or AM/PM. Admin date/hour/minute controls round-trip independently of the browser's timezone.
- Copy link uses the canonical site's `/#vote` URL and offers a selected readonly text field when clipboard permission is unavailable.
- `/api/announcement` is POST-only, admin-only and exact same-origin. It reads the real open activity, validates the selected environment/room/webhook, then sends only on a manual click. The message includes topic, deadline, voting URL and exactly one `<users/all>` mention. It does not send automatically or insert individual mentions.
- `claimAnnouncement` and `finishAnnouncement` are HMAC-protected Apps Script actions. A ScriptLock and persisted fingerprint prevent concurrent/repeated announcements for unchanged activity settings. Ambiguous delivery stays blocked for manual room verification, even after a settings change; there is no automatic network retry. A valid room-specific message receipt is required before marking sent. Credentials never enter browser responses or the stored status.
- Deploy updated Code.gs before the matching Worker build. `node test-announcement.mjs` tests formats/controls and sending with fully mocked transport: no live webhook is called.

### Current environment: TEST

Hosted runtime: `VOTING_ENV=test`, `CANDIDATE_SOURCE=chat_members_only`, `GOOGLE_CHAT_SPACE_ID=AAQA0MkG6JM`, `GOOGLE_CHAT_SPACE_NAME=test pr review chat bot`. `GOOGLE_CHAT_WEBHOOK_URL` selects the test room; `GOOGLE_CHAT_PRODUCTION_WEBHOOK_URL` retains the untouched production secret for later use. Neither is embedded in source.

The signed sync persists the environment/source/space in Apps Script properties. Only active synced room members can be candidates, including backend vote validation; outsiders logging into Jira do not create candidates. Old candidate rows and votes remain preserved, inactive outside the selected room. The Worker suppresses old-room counts and candidates until the new-room sync succeeds. This changes the current website's environment, not its URL or public audience, and does not activate reminder triggers.

- The Site Worker reads `tech-cop-trueidapp-mobile` (`AAQASHHP1Y4`) with the read-only `chat.memberships.readonly` scope. Only the app's existing admins can sync or reconnect, and POST requests require the same-origin check.
- Configure `GOOGLE_CHAT_CLIENT_ID`, `GOOGLE_CHAT_CLIENT_SECRET`, and `GOOGLE_CHAT_REFRESH_TOKEN` as Site secrets. Set `GOOGLE_CHAT_SPACE_ID` and `GOOGLE_CHAT_SPACE_NAME` as runtime variables. Never embed these credentials or the exported roster in public assets.
- The Worker refreshes access tokens server-side, fetches every membership page, and sends a signed `syncChatMembers` request to Apps Script only after the complete list passes validation.
- `ChatMembers` stores email, name, canonical `users/...` Chat ID, active status, and last sync time. Candidates retain their original stable ID if matched by email. Jira login includes the verified email and reuses a matching candidate rather than inserting a duplicate.
- Removed members are marked inactive, never deleted. No event is created, and existing Votes are preserved. Failure, an empty list, or incomplete pagination leaves the previous roster unchanged.
- The admin UI shows count, last sync, and members. The Google connection button starts `/auth/google-chat` and returns to `/oauth/google-chat/callback`. Register `https://trueid-voting.chawapon-rr.chatgpt.site/oauth/google-chat/callback` as an authorized redirect URI on the existing Google OAuth Web client. Keep the existing Playground URI if still needed for troubleshooting.
- OAuth uses offline consent, a ten-minute signed HttpOnly cookie bound to the admin's Jira session, and PKCE. The Worker exchanges the code server-side, verifies access to the configured room, saves the refresh token in Script Properties, and syncs members automatically. Tokens never appear in the page, redirect, or public assets. Cancelled/invalid consent preserves the current connection. This connects Chat access; it does not replace Jira voter login.
- External OAuth projects in Testing do not qualify for the identity-only seven-day exception because this feature reads Chat memberships. Reauthorization is required after the test grant expires. For unattended long-term syncing, use an organization-owned Internal project where applicable or complete the applicable production/admin approvals. Reconnection does not bypass Workspace policy.
- Run `node test-chat-sync.mjs` for the bounded sync/authorization regression checks and `node build.mjs` to create the Worker bundle. Update the existing Apps Script deployment to a new version before publishing the matching Site version.
- A manual sync button is implemented. There is no scheduled job and this feature sends no Chat messages.
