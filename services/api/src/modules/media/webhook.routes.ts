import express, { Router } from 'express';
import type { AppContext } from '../../context';
import { Media } from '../../models';
import { recordAudit } from '../../services/audit.service';
import { onLiveConnected, onLiveDisconnected } from './live.service';
import { WebhookAuthError } from './provider';
import { applyAsset } from './videos.service';

/**
 * `POST /api/v1/webhooks/video` — provider notifications. The body is parsed as RAW bytes (the signature is computed
 * over the exact bytes, so this router must be mounted before `express.json()`), authenticated by the provider
 * adapter (HMAC + timestamp window, or shared secret), and processed idempotently. Failures reveal nothing.
 */
export function videoWebhookRouter(ctx: AppContext): Router {
  const router = Router();
  router.post('/video', express.raw({ type: () => true, limit: '1mb' }), async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    let event;
    try {
      event = ctx.video.parseWebhook(raw, req.headers);
    } catch (error) {
      if (error instanceof WebhookAuthError) {
        await recordAudit({
          actorId: null,
          action: 'webhook.rejected',
          targetType: 'webhook',
          metadata: { provider: ctx.video.name },
          ...(req.ip ? { ip: req.ip } : {}),
        }).catch(() => undefined);
        res
          .status(401)
          .json({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid webhook signature' } });
        return;
      }
      throw error;
    }

    const deps = { env: ctx.env, video: ctx.video };
    switch (event.type) {
      case 'asset.updated':
        await applyAsset(event.asset, deps);
        break;
      case 'asset.deleted':
        await Media.updateOne(
          { provider: ctx.video.name, providerAssetId: event.providerAssetId },
          { $set: { providerDeletedAt: new Date() } },
        );
        break;
      case 'live.connected':
        await onLiveConnected(event.providerInputId, ctx.video.name);
        break;
      case 'live.disconnected':
        await onLiveDisconnected(event.providerInputId, ctx.video.name);
        break;
      case 'ignored':
        break;
    }
    // Always 200 for authenticated events (even for ids we do not know) so the provider does not retry forever.
    res.json({ received: true });
  });
  return router;
}
