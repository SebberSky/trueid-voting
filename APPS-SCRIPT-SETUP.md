# Google Sheet backend setup

1. Open the voting Google Sheet.
2. Choose **Extensions → Apps Script**.
3. Replace the default code with the contents of `Code.gs`.
4. Save, then run `setup` once and authorize it.
5. Choose **Deploy → New deployment → Web app**.
6. Set **Execute as: Me** and **Who has access: Anyone**.
7. Copy the Web app URL; the website will use it for `GET ?action=config`, `GET ?action=results`, and `POST` actions `vote` / `saveConfig`.

Each voter must send a stable `voterId` (the Jira account ID). The script rejects a second vote from the same ID.

## Google Chat member sync

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
