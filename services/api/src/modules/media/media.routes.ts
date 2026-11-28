import { Router, type RequestHandler } from 'express';
import {
  commentListQuerySchema,
  createCommentSchema,
  createLiveSchema,
  createVideoUploadSchema,
  liveListQuerySchema,
  reactionSchema,
  reportSchema,
  updateVideoSchema,
  videoFeedQuerySchema,
  videoViewSchema,
} from '@farmplus/validation';
import type { AppContext } from '../../context';
import { HttpError } from '../../lib/errors';
import { absoluteUrl, parse, requireActor } from '../../lib/http';
import { parseObjectId } from '../../lib/object-id';
import { authenticate } from '../../middleware/authenticate';
import { rateLimits } from '../../middleware/rate-limit';
import { createComment, listComments } from '../community/comments.service';
import { reportContent } from '../community/moderation.service';
import { react, unreact } from '../community/reactions.service';
import {
  createLive,
  endLive,
  getIngest,
  getLive,
  hostEligibility,
  listLive,
  livePlayback,
} from './live.service';
import {
  createUpload,
  deleteVideo,
  getVideo,
  listVideos,
  recordView,
  refreshVideo,
  updateVideo,
  videoLimits,
  videoPlayback,
} from './videos.service';

const id = (req: { params: Record<string, unknown> }) => parseObjectId(req.params['id']);

/**
 * VIDEO_PROVIDER=none: refuse to create videos or live streams before anything is recorded (a provider call would fail
 * and leave a failed record behind). Everything else (lists, comments, existing records) keeps working.
 */
const requireVideoProvider =
  (ctx: AppContext): RequestHandler =>
  (_req, _res, next) => {
    if (ctx.env.VIDEO_PROVIDER === 'none')
      return next(
        new HttpError(503, 'VIDEO_NOT_CONFIGURED', 'Video and live streaming are not enabled yet'),
      );
    next();
  };

/** `/api/v1/videos` — every route needs a signed-in, active user. */
export function videosRouter(ctx: AppContext): Router {
  const router = Router();
  const limits = rateLimits(ctx.env);
  const deps = { env: ctx.env, video: ctx.video };
  router.use(authenticate(ctx));

  router.get('/limits', (_req, res) => {
    res.json(videoLimits(ctx.env, ctx.video));
  });
  router.get('/', async (req, res) => {
    res.json(await listVideos(requireActor(req), parse(videoFeedQuerySchema, req.query)));
  });
  router.post('/uploads', requireVideoProvider(ctx), limits.upload, async (req, res) => {
    const ticket = await createUpload(
      requireActor(req),
      parse(createVideoUploadSchema, req.body),
      deps,
    );
    res.status(201).json({
      ...ticket,
      upload: { ...ticket.upload, url: absoluteUrl(req, ticket.upload.url)! },
    });
  });
  router.get('/:id', async (req, res) => {
    res.json({ video: await getVideo(requireActor(req), id(req)) });
  });
  router.patch('/:id', limits.post, async (req, res) => {
    res.json({
      video: await updateVideo(requireActor(req), id(req), parse(updateVideoSchema, req.body)),
    });
  });
  router.delete('/:id', async (req, res) => {
    await deleteVideo(requireActor(req), id(req), deps);
    res.status(204).end();
  });
  router.post('/:id/refresh', limits.videoRefresh, async (req, res) => {
    res.json({ video: await refreshVideo(requireActor(req), id(req), deps) });
  });
  router.get('/:id/playback', limits.playback, async (req, res) => {
    const p = await videoPlayback(requireActor(req), id(req), deps);
    res.json({
      ...p,
      url: absoluteUrl(req, p.url)!,
      thumbnailUrl: absoluteUrl(req, p.thumbnailUrl),
    });
  });
  router.post('/:id/views', limits.view, async (req, res) => {
    const { watchedSeconds } = parse(videoViewSchema, req.body);
    res.json(await recordView(requireActor(req), id(req), watchedSeconds));
  });
  router.post('/:id/reactions', limits.react, async (req, res) => {
    const { type } = parse(reactionSchema, req.body ?? {});
    res.json(await react(requireActor(req), 'video', id(req), type));
  });
  router.delete('/:id/reactions', limits.react, async (req, res) => {
    res.json(await unreact(requireActor(req), 'video', id(req)));
  });
  router.get('/:id/comments', async (req, res) => {
    res.json(
      await listComments(
        requireActor(req),
        id(req),
        parse(commentListQuerySchema, req.query),
        'video',
      ),
    );
  });
  router.post('/:id/comments', limits.comment, async (req, res) => {
    res.status(201).json({
      comment: await createComment(
        requireActor(req),
        id(req),
        parse(createCommentSchema, req.body),
        'video',
      ),
    });
  });
  router.post('/:id/reports', limits.report, async (req, res) => {
    res
      .status(201)
      .json(
        await reportContent(requireActor(req), 'video', id(req), parse(reportSchema, req.body)),
      );
  });
  return router;
}

/** `/api/v1/live` */
export function liveRouter(ctx: AppContext): Router {
  const router = Router();
  const limits = rateLimits(ctx.env);
  router.use(authenticate(ctx));

  router.get('/', async (req, res) => {
    res.json(await listLive(requireActor(req), parse(liveListQuerySchema, req.query)));
  });
  router.post('/', requireVideoProvider(ctx), limits.live, async (req, res) => {
    res
      .status(201)
      .json(await createLive(requireActor(req), parse(createLiveSchema, req.body), ctx.video));
  });
  // Whether the caller may host (their own roles + one setting): the host page says so before the form (QA, 28 Nov).
  router.get('/eligibility', async (req, res) => {
    res.json(await hostEligibility(requireActor(req)));
  });
  router.get('/:id', async (req, res) => {
    res.json({ live: await getLive(requireActor(req), id(req)) });
  });
  router.post('/:id/end', async (req, res) => {
    res.json({ live: await endLive(requireActor(req), id(req), ctx.video) });
  });
  // POST (not GET): the response carries the stream key, which must never end up in URLs, caches or logs.
  router.post('/:id/ingest', limits.sensitive, async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.json(await getIngest(requireActor(req), id(req), ctx.video));
  });
  router.get('/:id/playback', limits.playback, async (req, res) => {
    const p = await livePlayback(requireActor(req), id(req), ctx.video);
    res.json({
      ...p,
      url: absoluteUrl(req, p.url)!,
      thumbnailUrl: absoluteUrl(req, p.thumbnailUrl),
    });
  });
  router.post('/:id/reports', limits.report, async (req, res) => {
    res
      .status(201)
      .json(await reportContent(requireActor(req), 'live', id(req), parse(reportSchema, req.body)));
  });
  return router;
}
