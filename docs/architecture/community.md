# Community feed (Part 09)

API: `services/api/src/modules/community/` · Collections: `posts`, `comments`, `reactions`, `follows`, `content_reports`.
Web: `apps/web/src/pages/community/` (route `/community`) and the moderation queue `apps/web/src/pages/admin/moderation/` (`/admin/moderation`).
Mobile: `apps/mobile/app/community/**`, `src/components/community/**` (entry card on the Home tab).

## Model

| Collection        | Notes                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `posts`           | author, text (≤ 2000), ≤ 4 media (`image`/`video`, https links only), `visibility`, `status`, counters, `edits[]`, `moderation[]`  |
| `comments`        | `postId`, `parentId` (replies are one level deep: a reply to a reply attaches to the top-level comment), status, counters, history |
| `reactions`       | one row per `(targetType, targetId, userId)` — **unique index**; target is a post or a comment                                     |
| `follows`         | unique `(followerId, followeeId)`                                                                                                  |
| `content_reports` | reporter, target, reason, **snapshot of the reported content**, status, resolution; unique open report per `(reporter, target)`    |

Content `status`: `published` (visible), `hidden` / `removed` (set by moderators), `deleted` (set by the author; soft delete). Nothing is ever physically removed, so
moderators keep the evidence and every status change is appended to `moderation[]` (who, when, why).

## Rules enforced by the API

- **Authentication on everything**; the feed is for signed-in members. Public author data is only `id`, `displayName`, `avatarUrl` (never e-mail/phone).
- **Visibility** (`public` / `followers` / `private`) is decided in one function (`loadVisiblePost`). Feed, by-id read, comments, reactions and reports all go through
  it, so a post the caller may not see is `404` everywhere (indistinguishable from missing). Unfollowing removes access immediately.
- **Edit/delete only your own content** (`404` for anyone else, even the post owner for comments, even moderators). Edits keep the previous text (last 10) and mark `editedAt`.
  Moderated content is locked for the author (`409 CONTENT_LOCKED`); the author can still delete it. A moderator can never resurrect something the author deleted.
- **No mass assignment**: strict schemas reject `authorId`, `status`, counters, etc.
- **Media is external**: only `https` URLs, host allow-list `MEDIA_ALLOWED_HOSTS` (same setting as animal media; required in production), MIME prefix must match the kind,
  no duplicate URL in a post. FARM+ stores links, never files. Clients render with `referrerpolicy="no-referrer"` and lazy loading (web), text is never rendered as HTML.
- **Reactions are idempotent**: the unique index decides; the counter only moves when a row was really inserted/removed (30 parallel likes → 1 row, count 1).
- **Follows**: idempotent; not yourself; target must be an active user. `GET /users/:id/profile` shows counts of _public_ posts only.
- **Reports**: only on content you can see, not your own, one open report per reporter/target (`409 ALREADY_REPORTED`). Moderators resolve with `dismiss` / `hide` / `remove`;
  an action settles every open report on the same content. Self-moderation (own content, own report) is refused.
- **Moderation permission** `content.moderate` (roles `moderator`, `admin`, `super_admin` by default; MFA-protected like every staff permission → `403 MFA_REQUIRED` without it).
- **Audit log**: post/comment create/update/delete, reports, resolutions, moderation changes, follow/unfollow — metadata never contains post text.
- **Rate limits** (per IP, in-memory): 30 posts/h, 120 comments/h, 600 reactions/h, 120 follows/h, 30 reports/h.

## Feed & ranking

`GET /api/v1/posts?scope=all|following&sort=recent|trending&authorId&limit&cursor` returns `{ items, nextCursor? }`.

- Cursor pagination, opaque and validated (a forged cursor is `400`). `recent`: `(createdAt, _id)` descending — stable while new posts arrive.
  `trending`: posts of the last 7 days ordered by `engagement` (= reactions + 2 × comments, maintained with the counters) then `_id`. It is deliberately simple:
  no time decay inside the window, no personalisation.
- `following` = people you follow plus yourself. Followers-only posts reach followers only; private posts are only returned to the author.
- Comments: oldest first, top-level (`parentId` omitted) or replies of one comment (`?parentId=`), also cursor-paginated.

## API summary

| Method           | Path                                          | Notes                                             |
| ---------------- | --------------------------------------------- | ------------------------------------------------- |
| GET / POST       | `/posts`                                      | feed / create                                     |
| GET/PATCH/DELETE | `/posts/:id`                                  | read / edit (author) / soft-delete (author)       |
| POST / DELETE    | `/posts/:id/reactions`                        | like / unlike                                     |
| GET / POST       | `/posts/:id/comments`                         | list (`?parentId`) / create (`{body, parentId?}`) |
| PATCH / DELETE   | `/comments/:id`                               | author only                                       |
| POST / DELETE    | `/comments/:id/reactions`                     |                                                   |
| POST             | `/posts/:id/reports`, `/comments/:id/reports` | `{reason, details?}`                              |
| POST / DELETE    | `/users/:id/follow`                           | follow / unfollow                                 |
| GET              | `/users/:id/profile`                          | public profile + counts + `isFollowing`           |
| GET              | `/moderation/reports?status&cursor`           | `content.moderate`                                |
| GET              | `/moderation/reports/:id`                     | `content.moderate`                                |
| POST             | `/moderation/reports/:id/resolve`             | `{action: dismiss\|hide\|remove, note?}`          |
| POST             | `/moderation/:post\|comment/:id/status`       | `{status: published\|hidden\|removed, reason}`    |
| GET              | `/moderation/:post\|comment/:id/history`      | who/when/why                                      |

Errors: `404` (not found / not visible / not yours), `409 CONTENT_LOCKED`, `ALREADY_REPORTED`, `ALREADY_RESOLVED`, `ALREADY_DELETED`, `CANNOT_REPORT_OWN`,
`403 SELF_MODERATION`, `400 CANNOT_FOLLOW_SELF`, `400 VALIDATION_ERROR`.

## Known limitations

- No notifications (new comment/follower), no mentions/hashtags/search, no link previews, no blocking/muting of users.
- Posts of an author who is later suspended stay in feeds until moderated (their profile and follow button do disappear). Moderators act on content, not on accounts, here;
  suspending the account is an Admin → Users action.
- Trending is a simple engagement sort (see above); counters are denormalised and could drift after a manual database edit (no reconciliation job yet).
- Rate limits are per IP and in-memory (single instance); use a shared store before running several API instances.
- Video playback: web uses `<video>`; mobile opens videos in the system player/browser (no video library is installed). Mobile edits only the text of comments (a post's text/media/visibility are edited on web).
- Existing databases: new permission `content.moderate` is added at startup; the default `moderator`/`admin` roles only receive it when a role is first created, so an admin must grant
  it to already existing roles (super_admin gets it automatically).
