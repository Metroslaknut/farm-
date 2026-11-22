/* eslint-disable @typescript-eslint/no-explicit-any -- generic record engine: shape is driven by the per-kind config/schema */
import type { Router } from 'express';
import { type Request, type RequestHandler } from 'express';
import { addMediaSchema, correctionSchema, voidSchema } from '@farmplus/validation';
import type { AppContext } from '../../context';
import { parse } from '../../lib/http';
import { parseObjectId } from '../../lib/object-id';
import { farmContext } from '../farms/farms.controller';
import {
  addAttachment,
  correctRecord,
  getRecord,
  removeAttachment,
  voidRecord,
  type RecordContext,
  type RecordSpec,
} from './record-core';
import { z } from 'zod';

/** Actor + farm access + media policy for one request. `:farmId` comes from the parent router. */
export async function recordContext(req: Request, ctx: AppContext): Promise<RecordContext> {
  const { actor, access } = await farmContext(req);
  return {
    actor,
    access,
    policy: {
      allowedHosts: ctx.env.MEDIA_ALLOWED_HOSTS,
      production: ctx.env.NODE_ENV === 'production',
    },
    photos: ctx.photos,
  };
}

const removeSchema = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

/**
 * The routes every record kind shares: read one (with its full change history), correct, void, attach/detach
 * files. A kind adds its own `POST /` and `GET /` on the same router.
 */
export function mountCommonRecordRoutes(
  router: Router,
  ctx: AppContext,
  spec: RecordSpec<any, any>,
): void {
  const id = (req: Request) => parseObjectId(req.params['id']);
  const handler =
    (fn: (req: Request, rc: RecordContext) => Promise<unknown>, status = 200): RequestHandler =>
    async (req, res) => {
      res.status(status).json({ record: await fn(req, await recordContext(req, ctx)) });
    };

  router.get(
    '/:id',
    handler(async (req, rc) => getRecord(spec, rc.access, id(req))),
  );
  router.post(
    '/:id/corrections',
    handler(async (req, rc) => correctRecord(spec, rc, id(req), parse(correctionSchema, req.body))),
  );
  router.post(
    '/:id/void',
    handler(async (req, rc) => voidRecord(spec, rc, id(req), parse(voidSchema, req.body).reason)),
  );
  router.post(
    '/:id/attachments',
    handler(
      async (req, rc) => addAttachment(spec, rc, id(req), parse(addMediaSchema, req.body)),
      201,
    ),
  );
  router.post(
    '/:id/attachments/:attachmentId/remove',
    handler(async (req, rc) =>
      removeAttachment(
        spec,
        rc,
        id(req),
        parseObjectId(req.params['attachmentId']),
        parse(removeSchema, req.body).reason,
      ),
    ),
  );
}
