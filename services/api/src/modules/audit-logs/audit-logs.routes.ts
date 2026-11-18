import { Router, type RequestHandler } from 'express';
import { auditLogListQuerySchema } from '@farmplus/validation';
import { parse } from '../../lib/http';
import { requirePermission } from '../../middleware/authorize';
import { listAuditLogs } from '../../services/audit.service';

const list = (async (req, res) => {
  res.json(await listAuditLogs(parse(auditLogListQuerySchema, req.query)));
}) satisfies RequestHandler;

/** Mounted under `/admin/audit-logs`. Read-only by design: audit records are never edited or deleted via the API. */
export function auditLogsRoutes(): Router {
  const router = Router();
  router.get('/', requirePermission('audit_logs.read'), list);
  return router;
}
