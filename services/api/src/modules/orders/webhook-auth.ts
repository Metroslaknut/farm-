import type { RequestHandler } from 'express';
import { recordAudit } from '../../services/audit.service';
import { WebhookAuthError } from '../media/provider';
import { verifyHmacHeader } from '../media/provider/signature';

/**
 * Raw-body, HMAC-authenticated webhook handler: 404 while the secret is not configured, 401 (+ audit) for a bad or stale
 * signature, 400 for malformed JSON. The handler only ever sees a body whose signature has been verified.
 */
export const signedWebhook =
  (
    secret: string | undefined,
    name: string,
    handle: (body: unknown) => Promise<unknown>,
  ): RequestHandler =>
  async (req, res) => {
    if (!secret) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
      return;
    }
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    try {
      verifyHmacHeader(secret, req.headers, raw, new Date());
    } catch (error) {
      if (!(error instanceof WebhookAuthError)) throw error;
      await recordAudit({
        actorId: null,
        action: 'webhook.rejected',
        targetType: 'webhook',
        metadata: { source: name },
        ...(req.ip ? { ip: req.ip } : {}),
      }).catch(() => undefined);
      res
        .status(401)
        .json({ error: { code: 'INVALID_SIGNATURE', message: 'Invalid webhook signature' } });
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON' } });
      return;
    }
    res.json({ received: true, ...((await handle(body)) as object) });
  };
