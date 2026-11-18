import { Router } from 'express';
import {
  moderateContentSchema,
  moderationTargetSchema,
  reportListQuerySchema,
  resolveReportSchema,
} from '@farmplus/validation';
import type { AppContext } from '../../context';
import { parse, requireActor } from '../../lib/http';
import { parseObjectId } from '../../lib/object-id';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { runMediaCleanup } from '../media/cleanup.service';
import {
  getReport,
  listReports,
  moderateContent,
  moderationHistory,
  resolveReport,
} from './moderation.service';

/** `/api/v1/moderation` — everything needs the platform permission `content.moderate` (and an MFA session). */
export function moderationRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx), requirePermission('content.moderate'));

  router.get('/reports', async (req, res) => {
    res.json(await listReports(parse(reportListQuerySchema, req.query)));
  });
  router.get('/reports/:id', async (req, res) => {
    res.json({ report: await getReport(parseObjectId(req.params['id'])) });
  });
  router.post('/reports/:id/resolve', async (req, res) => {
    res.json({
      report: await resolveReport(
        requireActor(req),
        parseObjectId(req.params['id']),
        parse(resolveReportSchema, req.body),
        ctx.video,
      ),
    });
  });
  // Housekeeping for stuck/expired uploads and stale live sessions (also runs on a timer in the API process).
  router.post('/media/cleanup', async (_req, res) => {
    res.json(await runMediaCleanup({ env: ctx.env, video: ctx.video }));
  });
  router.get('/:targetType/:id/history', async (req, res) => {
    const type = parse(moderationTargetSchema, req.params['targetType']);
    res.json(await moderationHistory(type, parseObjectId(req.params['id'])));
  });
  router.post('/:targetType/:id/status', async (req, res) => {
    const type = parse(moderationTargetSchema, req.params['targetType']);
    const { status, reason } = parse(moderateContentSchema, req.body);
    res.json(
      await moderateContent(
        requireActor(req),
        type,
        parseObjectId(req.params['id']),
        status,
        reason,
        ctx.video,
      ),
    );
  });
  return router;
}
