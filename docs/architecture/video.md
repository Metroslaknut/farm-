# Short video & live streaming (Part 10)

API: `services/api/src/modules/media/` (+ community modules reused for likes, comments, reports, moderation) · Collections: `media`, `live_sessions`, `video_metrics`.
Web: `apps/web/src/pages/{videos,live}/` (`/videos`, `/live`). Mobile: `app/(tabs)/videos.tsx`, `app/videos/**`, `app/live/**`, `src/components/video/**`.
Shared pure helpers (feed windowing, watch clock, upload checks): `packages/shared-utils/src/video.ts`.

## Provider (no custom media infrastructure)

Everything provider-specific sits behind `VideoProvider` (`modules/media/provider/types.ts`): direct upload URLs, asset lookup/deletion, live inputs,
short-lived signed playback, and webhook authentication. Selected by `VIDEO_PROVIDER`:

| Value        | Use                                                                                                                                                                                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cloudflare` | **Cloudflare Stream** adapter (direct creator uploads, live inputs with RTMPS, token-signed HLS). Needs `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_STREAM_API_TOKEN`, `CLOUDFLARE_STREAM_CUSTOMER_CODE`, `VIDEO_WEBHOOK_SECRET`.                           |
| `none`       | No streaming account yet: `POST /videos/uploads` and `POST /live` answer `503 VIDEO_NOT_CONFIGURED` before anything is recorded; lists, comments and existing records keep working; every webhook is rejected. Allowed in production (warning only). |
| `mock`       | In-memory development/test stand-in (stores uploads in RAM, serves them via signed URLs). **Refused in production** by the env schema. Not infrastructure.                                                                                           |

Credentials are read only in `createVideoProvider` (server). Clients receive one-time upload URLs and short-lived playback URLs, never tokens or keys; provider error
bodies are never forwarded. Every asset is created with `requireSignedURLs`, so a playback URL is only obtained from FARM+ after its own authorisation check.
Swapping providers (Mux, …) means writing one adapter.

## Videos

1. `POST /videos/uploads` `{title, caption?, filename, mimeType, sizeBytes, visibility}` → checks (auth, type allow-list + extension match, size ≤ `VIDEO_MAX_UPLOAD_MB`,
   ≤ 5 open uploads, ≤ 30/day) → `media` row `pending_upload` + one-time URL (30 min). The client uploads **directly to the provider** (XHR with progress).
2. The provider's webhook (or the creator's `POST /videos/:id/refresh`, or the cleanup job) moves it `pending_upload → processing → ready | failed`. Transitions are
   monotonic and idempotent; `ready`/`failed` are final. On `ready` the provider-reported size and duration (≤ `VIDEO_MAX_DURATION_SECONDS`) are re-checked — declared values are never trusted.
3. Processing status (`processing.state`, plus a failure code/message for the creator only) is visible in **My videos** and during upload.
4. `GET /videos` (cursor feed, newest first; `scope=following`, `creatorId`, `mine=true`), `GET /videos/:id`, `PATCH`, `DELETE` (creator only; deletes the provider asset).
5. `GET /videos/:id/playback` → short-lived signed URL, only for viewers who may watch (published + ready + visibility). Clients fetch it for the active slide and
   its neighbours only, which keeps the feed cheap and tokens short-lived.
6. **Views** (`POST /videos/:id/views {watchedSeconds}`): counted once per viewer per 24 h (unique `video_metrics` row + atomic window renewal), only after
   min(3 s, half the duration) of real watch time (client-measured with a watch clock that ignores seeks/loops, validated server-side), never for the creator's own plays. 50 parallel reports → 1 view.
7. Likes (`reactions`, targetType `video`), comments (`/videos/:id/comments`, same reply/edit/delete rules as posts), creator profile (`/users/:id/profile` now has `videoCount`; feeds filter by creator).

Visibility is decided in `video-access.ts` (creator sees everything of their own; others need published + ready + public/follower rule), exactly like posts.

## Live streaming

- **Host authorization**: only users with the `farm_owner` or `seller` role may create a session (setting `live.requireHostRole`, default on, can be turned off by an admin).
  One unfinished session per host (partial unique index). Another user cannot end, read the key of or otherwise control a session: `404`.
- `POST /live` → provider live input; the **stream key is returned once to the host** (and again via `POST /live/:id/ingest`, host-only, audited, `no-store`). It is never stored in MongoDB,
  never listed, never in audit metadata. The web page hides it again after 60 s.
- States: `created → live ⇄ interrupted → ended` (`failed` reserved). Driven by authenticated provider webhooks (`live.connected` / `live.disconnected`); the host ends with `POST /live/:id/end`
  (atomic, idempotent; the provider input is deleted so the key stops working). Cleanup closes sessions interrupted > 5 min or never started within 12 h.
- **Viewer access**: `public` or `followers` (needs a follow). Viewers see only running streams; playback is `GET /live/:id/playback` (409 before it starts / after it ends). Ended streams are 404 for viewers (clients show "ended").
- Reports/moderation: videos and live streams are report targets; a moderator action on a stream (`hide`/`remove`) also stops it and removes the provider input.

## Webhooks

`POST /api/v1/webhooks/video` is mounted **before** `express.json()` and parses the raw bytes. The adapter authenticates every request (Cloudflare: HMAC-SHA256 over `time.body` in
`Webhook-Signature` with a ±5 min window, or the `cf-webhook-auth` shared-secret header; constant-time comparison). Invalid → `401` + audit `webhook.rejected`, nothing processed.
Valid events always get `200`, unknown ids/events are ignored.

## Cleanup & failed uploads

`runMediaCleanup` (every 10 min inside the API process, `pnpm --filter @farmplus/api media:cleanup`, or `POST /moderation/media/cleanup` for moderators): expired upload URLs →
recovered if the provider has the file, else `failed(upload_expired)`; videos stuck in processing > 6 h → failed; provider assets of failed / creator-deleted videos deleted (retried after
provider errors), moderator-removed ones after 30 days; stale live sessions closed. Every step is an atomic transition, so it is safe on several instances.

## Known limitations

- **The Cloudflare adapter was written against Cloudflare's documented API but has not been run against a real account** (no credentials were used). Verify with a Stream account before
  production: direct upload, signed tokens for live inputs, and the webhook formats/secret (the `Webhook-Signature` HMAC and the notification `cf-webhook-auth` variant are both supported).
- Live streams are not recorded (recording is disabled); no live chat, no live viewer counts; hosting needs an RTMPS encoder (OBS etc.) — the mobile app only watches.
- Video playback on iOS needs H.264/HEVC MP4/MOV/HLS; WebM uploads are accepted but only play where the platform supports them (the provider transcodes to HLS in production).
- Short videos have no ranking/recommendations (newest first) and no search; view counts are per-viewer-per-day, not unique-forever.
- The in-memory mock stores files in RAM: development only. Rate limits are per IP and in memory.
- Existing databases: `content.moderate` already covers video/live moderation; `live.requireHostRole` is a new setting (default on). New `media` indexes are built at startup.
