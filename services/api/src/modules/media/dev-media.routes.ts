import express, { Router } from 'express';
import { VIDEO_UPLOAD_MIME_TYPES } from '@farmplus/shared-types';
import type { AppContext } from '../../context';
import { ProviderError, type MockVideoProvider } from './provider';
import { applyAsset, maxUploadBytes } from './videos.service';

/**
 * DEVELOPMENT / TEST ONLY (mounted only for the mock provider outside production): stands in for the provider's upload
 * endpoint and CDN so the browser/mobile flow can be tried end to end without credentials. The upload id in the URL is
 * the one-time capability, exactly like a real provider's signed upload URL.
 */
export function devMediaRouter(ctx: AppContext, mock: MockVideoProvider): Router {
  const router = Router();
  const limit = maxUploadBytes(ctx.env);

  router.post('/uploads/:id', express.raw({ type: () => true, limit }), async (req, res) => {
    const mime = (req.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!(VIDEO_UPLOAD_MIME_TYPES as readonly string[]).includes(mime)) {
      res
        .status(415)
        .json({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported video type' } });
      return;
    }
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (bytes.length === 0) {
      res.status(400).json({ error: { code: 'EMPTY_FILE', message: 'The file is empty' } });
      return;
    }
    try {
      const asset = mock.receiveUpload(String(req.params['id']), bytes, mime);
      await applyAsset(
        { ...asset, durationSeconds: Number(req.get('x-duration')) || undefined },
        {
          env: ctx.env,
          video: ctx.video,
        },
      );
      res.status(201).json({ ok: true });
    } catch (error) {
      if (error instanceof ProviderError) {
        res
          .status(error.status ?? 400)
          .json({ error: { code: 'UPLOAD_REJECTED', message: error.message } });
        return;
      }
      throw error;
    }
  });

  router.get('/files/:id', (req, res) => {
    const id = String(req.params['id']);
    const exp = Number(req.query['exp']);
    const token = String(req.query['token'] ?? '');
    if (!Number.isInteger(exp) || !mock.verifyFileToken(id, exp, token)) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Invalid or expired link' } });
      return;
    }
    const file = mock.readFile(id);
    if (!file) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
      return;
    }
    const total = file.bytes.length;
    res.setHeader('content-type', file.mimeType);
    res.setHeader('accept-ranges', 'bytes');
    // Helmet defaults to same-origin; a CDN-like endpoint must be embeddable from the web/mobile app origins.
    res.setHeader('cross-origin-resource-policy', 'cross-origin');
    res.setHeader('cache-control', 'private, no-store');
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.get('range') ?? '');
    if (m && (m[1] || m[2])) {
      const start = m[1] ? Number(m[1]) : Math.max(0, total - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;
      if (start > end || start >= total) {
        res.status(416).setHeader('content-range', `bytes */${total}`).end();
        return;
      }
      res.status(206);
      res.setHeader('content-range', `bytes ${start}-${end}/${total}`);
      res.setHeader('content-length', end - start + 1);
      res.end(file.bytes.subarray(start, end + 1));
      return;
    }
    res.setHeader('content-length', total);
    res.end(file.bytes);
  });
  return router;
}
