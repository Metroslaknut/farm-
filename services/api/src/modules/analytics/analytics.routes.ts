import { Router, type Response } from 'express';
import {
  adminDashboardQuerySchema,
  adminExportQuerySchema,
  farmDashboardQuerySchema,
  farmExportQuerySchema,
} from '@farmplus/validation';
import type { AppContext } from '../../context';
import { forbidden } from '../../lib/errors';
import { parse, requireActor } from '../../lib/http';
import { authenticate } from '../../middleware/authenticate';
import { rateLimits } from '../../middleware/rate-limit';
import { recordAudit } from '../../services/audit.service';
import { farmContext } from '../farms/farms.controller';
import { adminContext, adminDashboard, allowedAdminSections } from './admin.service';
import { safeFilename, toCsv } from './csv';
import { DEFINITIONS } from './definitions';
import { adminExport, farmExport, type ExportData } from './exports';
import { allowedFarmSections, buildFarmContext, farmDashboard } from './farm.service';

function sendCsv(res: Response, data: ExportData): void {
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${safeFilename(data.filename)}.csv"`);
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  if (data.truncated) res.setHeader('x-export-truncated', 'true');
  res.send(toCsv(data.columns, data.rows));
}

/** `/api/v1/farms/:farmId/dashboard` — the farm dashboard and its CSV export. Sections follow the caller's farm permissions. */
export function farmDashboardRouter(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  const limits = rateLimits(ctx.env);
  router.get('/', limits.dashboard, async (req, res) => {
    const { access } = await farmContext(req);
    res.setHeader('cache-control', 'no-store');
    res.json(await farmDashboard(access, parse(farmDashboardQuerySchema, req.query)));
  });
  router.get('/export', limits.dashboardExport, async (req, res) => {
    const { actor, access } = await farmContext(req);
    const q = parse(farmExportQuerySchema, req.query);
    // The export follows EXACTLY the permission of the dashboard section it mirrors.
    const section = (
      {
        orders: 'sales',
        animals: 'animals',
        growth: 'growth',
        health: 'health',
        feeding: 'feeding',
        costs: 'costs',
        assessments: 'assessments',
      } as const
    )[q.section];
    if (!allowedFarmSections(access).includes(section))
      throw forbidden('You do not have permission to export this', 'EXPORT_FORBIDDEN');
    const data = await farmExport(q.section, await buildFarmContext(access, q));
    await recordAudit({
      actorId: actor.userId,
      action: 'analytics.export',
      targetType: 'farm',
      targetId: access.farm._id,
      metadata: { section: q.section, rows: data.rows.length, truncated: data.truncated },
      ...(actor.ip ? { ip: actor.ip } : {}),
    });
    sendCsv(res, data);
  });
  return router;
}

/** `/api/v1/analytics/definitions` — every metric, defined. Public to any signed-in user (it describes calculations, not data). */
export function analyticsDefinitionsRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx));
  router.get('/definitions', (_req, res) => {
    res.json({ definitions: DEFINITIONS });
  });
  return router;
}

/** What the actor could see once MFA-verified (permissions withheld until then included). */
const withMfa =
  (actor: ReturnType<typeof requireActor>) =>
  (p: string): boolean =>
    actor.access.permissions.has(p) || actor.access.withheld.has(p);
const mfaRequired = () =>
  forbidden('Multi-factor authentication is required for this action', 'MFA_REQUIRED');
/** Same answer as `requirePermission`: tell staff when completing MFA would give them access. */
const adminDenied = (actor: ReturnType<typeof requireActor>) =>
  allowedAdminSections(withMfa(actor)).length > 0 ? mfaRequired() : forbidden();

/** `/api/v1/admin/analytics` — the platform dashboard. Every section names the permission it needs; the CSV export mirrors them. */
export function adminAnalyticsRouter(ctx: AppContext): Router {
  const router = Router();
  const limits = rateLimits(ctx.env);
  router.use(authenticate(ctx));
  router.get('/', limits.dashboard, async (req, res) => {
    const actor = requireActor(req);
    const has = (p: string) => actor.access.permissions.has(p);
    if (allowedAdminSections(has).length === 0) throw adminDenied(actor);
    res.setHeader('cache-control', 'no-store');
    res.json(await adminDashboard(has, parse(adminDashboardQuerySchema, req.query)));
  });
  router.get('/export', limits.dashboardExport, async (req, res) => {
    const actor = requireActor(req);
    const has = (p: string) => actor.access.permissions.has(p);
    const q = parse(adminExportQuerySchema, req.query);
    const needs = (
      {
        signups: 'users',
        orders: 'orders',
        payments: 'payments',
        commissions: 'commissions',
        refunds: 'refunds',
        payouts: 'payouts',
      } as const
    )[q.section];
    if (!allowedAdminSections(has).includes(needs)) {
      if (allowedAdminSections(withMfa(actor)).includes(needs)) throw mfaRequired();
      throw forbidden('You do not have permission to export this', 'EXPORT_FORBIDDEN');
    }
    const data = await adminExport(q.section, adminContext(q));
    await recordAudit({
      actorId: actor.userId,
      action: 'analytics.export',
      targetType: 'platform',
      metadata: { section: q.section, rows: data.rows.length, truncated: data.truncated },
      ...(actor.ip ? { ip: actor.ip } : {}),
    });
    sendCsv(res, data);
  });
  return router;
}
