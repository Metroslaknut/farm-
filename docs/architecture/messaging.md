# Notifications & messaging (Part 17)

In-app notifications, unread counters, buyer ↔ farm chat and realtime delivery. Code: `services/api/src/modules/{notifications,chat,realtime}/`; web: header bell/messages links, `/notifications`, `/messages`, "Message seller" on listings and products, `/admin/message-reports`; realtime client: `packages/api-client/src/realtime.ts`. **Web only; no mobile screens.** Nothing here sends e-mail, SMS or push.

## Notifications

- **Events** (hooked where the change happens, after it succeeded; a failing notification never undoes the action — it is logged and swallowed):
  | Category     | Events                                                                                                                                                             | Who hears                                                                    |
  | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
  | `orders`     | placed, paid, processing, shipped, delivered, cancelled, refund started, refunded, payment expired                                                                 | the other party; the seller side for placed/paid; never the person who acted |
  | `offers`     | received, countered, accepted, declined, withdrawn                                                                                                                 | the other side of the negotiation (seller side = farm owners and managers)   |
  | `farm`       | member added / role changed / removed, sale completed                                                                                                              | the affected member; the seller side for sales                               |
  | `moderation` | listing and product approved / rejected / paused / restored, content hidden / removed / restored, registration decided, message report reviewed, messaging warning | the author / farm's owners and managers / applicant / reporter               |
  | `messages`   | new message                                                                                                                                                        | the other side of the conversation                                           |
- **Wording** (`templates.ts`) contains only facts the recipient may know (order number, status, the amount of an offer in _their_ negotiation, a moderator's reason addressed to them). **Never** another user's free text: offer notes and chat messages are not copied into notifications (tested).
- **Idempotent**: one notification per recipient and event (`eventKey`, unique index), so retries or duplicate hooks cannot announce an event twice. Chat messages **fold** into one unread notification per conversation (`groupKey`, with a count) so a burst is one item, not a flood.
- **Preferences**: per category, in-app on/off. `orders` and `moderation` are **locked on** (they concern money and account standing); trying to mute them is `409 CATEGORY_LOCKED`.
- **Retention**: notifications are a convenience, not a record — they age out after 180 days (TTL index); the audit log keeps the real history.
- **Privacy/scoping**: every query filters by the caller's id; another user's notification id is `404`.

## Unread counters

Always **recalculated from stored rows** (never incremented), so they cannot drift: notifications = unread rows for the user, per category; messages = messages from the _other_ side with no `readAt` in conversations the user takes part in. REST `GET /notifications/unread-count` and the realtime `unread:update` event return the same function, and a test checks live == REST == raw rows. For the farm side, read state is **shared by the team**: one owner/manager reading clears it for all of them.

## Chat

- **Model**: one conversation per _(buyer, farm)_, started from a live listing or product (so a farm cannot be messaged out of the blue). The **buyer** is one user; the **seller side** is the farm's current **owners and managers**, resolved from the database on every request. Workers/viewers, other farms, other buyers and platform staff get `404` for every route (not 403: ids cannot be probed). Removing a manager ends their access immediately; a manager added later reads the whole history.
- **Sending**: validated body (1–2000 chars, no control characters, trimmed, CRLF→LF), strict schemas (the side/sender are decided by the server, extra fields refused), stored and rendered as plain text. `clientId` makes retries idempotent (returns the original). Message numbers (`seq`) are atomic and strictly increasing; a lost duplicate race may leave a gap, which clients tolerate (they ask for "after N").
- **Rate limits**: HTTP limiter per IP **and** a database-backed cap per user (`chat.messagesPerMinute`, default 20) and for new conversations (`chat.newConversationsPerDay`, default 20) — correct across API instances. Both are settings.
- **Blocking**: either side can block a conversation. A block stops sending in **both** directions (and new threads with that farm), history stays readable, the blocked person is told only "cannot send" — never who blocked. Only the blocking side can lift it.
- **Reporting**: a participant reports the other side's message. The reported message and up to four before it are **copied into the report** (edits afterwards do not change the evidence); that is the only chat text moderators ever see — they cannot browse conversations (`404`). One open report per reporter and conversation. `content.moderate` staff can dismiss, warn, or **restrict messaging** (person-level, `chat_restrictions`; lifted with `DELETE /admin/chat/restrictions/:userId`). A moderator cannot resolve a report they are part of. Reporter (and warned person) are notified; every step is audited.

## Realtime (Socket.IO on the API's HTTP server, path `/socket.io`)

- **Authentication**: the access token in the handshake (`auth.token`) is verified like an HTTP request — signature, live session, active account (`authenticateToken`, shared with the HTTP middleware). Missing/forged/wrong-type/revoked/suspended → connection refused with a code. The connection **never outlives the token** and is re-checked every minute, so logout or suspension cuts it off (`auth:expired` then disconnect).
- **Authorization**: a socket joins only `user:<its own id>` automatically. `conversation:join` runs the **same gate as REST** (`accessConversation`); failure is `NOT_FOUND`. Joining is bounded (50 rooms) and payloads are validated. When a membership changes, `hub.revalidateUser` re-checks the user's rooms and removes (and tells) sockets that lost access. Server events are not sent to people who are not in the room; `connectionStateRecovery` is deliberately **off** so rooms are never restored without re-authorizing.
- **Abuse control**: 20 events / 10 s per socket (more are refused; persistent abuse disconnects), 10 KB max payload.
- **Events**: `notification:new`, `unread:update` (user room); `message:new`, `message:read` (conversation room); `conversation:update` (list refresh / `revoked`). Events are **hints** — the database is the source of truth.
- **Recovery** (`createRealtimeClient`): Socket.IO retries transport drops, but _not_ when the server ends the connection or rejects the handshake, so the client retries those itself with exponential backoff **after refreshing the token**; if the session cannot be refreshed it stops (`signed_out`) instead of hammering the server. After every reconnect it re-joins its rooms (re-authorized) and signals **resync**: the UI re-reads counters and fetches only what it missed (`GET …/messages?after=<last seq>`). The header shows a "reconnecting" indicator; sending keeps working over HTTP while offline.
- **Without a realtime server** (tests, worker, disabled) everything still works over HTTP; pushes are simply skipped.

## Limits and follow-ups

- **Single instance**: Socket.IO uses the in-memory adapter. Behind several API instances a Redis adapter (and sticky sessions for polling) is needed; REST, unread counts and rate limits are already instance-safe. Client resync covers missed events.
- Offer **expiry** and reservation release do not notify yet (only explicit actions do).
- Farm activity is membership and sales; reminders (vaccination due, withdrawal periods) are not implemented.
- No typing indicators, attachments or push/e-mail delivery; messages are plain text, not end-to-end encrypted, and stored unencrypted in MongoDB like other business data.
- The seller side is a shared team inbox: managers cannot hold private threads with a buyer, and a teammate's reply is shown with their display name.
- Block/restriction are conversation- and person-level; there is no global "block this user everywhere" list.
