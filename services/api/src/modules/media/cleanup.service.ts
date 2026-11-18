import type { ApiEnv } from '@farmplus/config/server';
import { ACTIVE_LIVE_STATES, LiveSession, Media } from '../../models';
import { recordAudit } from '../../services/audit.service';
import {
  MAX_LIVE_DURATION_MS,
  RECONNECT_GRACE_MS,
  UNSTARTED_TTL_MS,
  closeSession,
} from './live.service';
import type { VideoProvider } from './provider';
import { applyAsset } from './videos.service';

const MIN = 60_000;
const UPLOAD_GRACE_MS = 5 * MIN;
const PROCESSING_STUCK_MS = 6 * 60 * MIN;
const REMOVED_RETENTION_MS = 30 * 24 * 60 * MIN;

export interface CleanupReport {
  uploadsRecovered: number;
  uploadsExpired: number;
  processingFailed: number;
  assetsDeleted: number;
  assetDeleteErrors: number;
  livesClosed: number;
}

/**
 * Housekeeping for uploads and streams. Safe to run often and from several instances (every step is an atomic,
 * idempotent transition). Triggered on a timer by the API process, by `pnpm --filter @farmplus/api media:cleanup`, or by a moderator.
 *  1. Uploads whose URL expired: if the provider has the file after all (missed webhook) → recover; else → failed(upload_expired)
 *  2. Videos stuck in processing for hours → failed
 *  3. Provider assets of failed / author-deleted videos (and moderator-removed ones after 30 days) → deleted at the provider
 *  4. Live sessions: reconnect grace over, never started, or live beyond the maximum duration → ended; the provider input is removed
 */
export async function runMediaCleanup(
  deps: { env: ApiEnv; video: VideoProvider },
  now = new Date(),
): Promise<CleanupReport> {
  const report: CleanupReport = {
    uploadsRecovered: 0,
    uploadsExpired: 0,
    processingFailed: 0,
    assetsDeleted: 0,
    assetDeleteErrors: 0,
    livesClosed: 0,
  };
  const { video } = deps;

  // 1. expired upload URLs
  const expired = await Media.find({
    'processing.state': 'pending_upload',
    uploadExpiresAt: { $lt: new Date(now.getTime() - UPLOAD_GRACE_MS) },
  }).limit(200);
  for (const m of expired) {
    const asset = m.providerAssetId
      ? await video.getAsset(m.providerAssetId).catch(() => undefined)
      : null;
    if (asset && asset.state !== 'pending_upload') {
      const r = await applyAsset(asset, deps);
      if (r.applied) report.uploadsRecovered++;
      continue;
    }
    if (asset === undefined) continue; // provider unreachable: try again next run
    const res = await Media.updateOne(
      { _id: m._id, 'processing.state': 'pending_upload' },
      {
        $set: {
          'processing.state': 'failed',
          'processing.failureCode': 'upload_expired',
          'processing.failureMessage': 'The upload was never completed',
          'processing.updatedAt': now,
        },
      },
    );
    if (res.modifiedCount === 1) report.uploadsExpired++;
  }

  // 2. stuck processing
  const stuck = await Media.find({
    'processing.state': 'processing',
    'processing.updatedAt': { $lt: new Date(now.getTime() - 60 * MIN) },
  }).limit(200);
  for (const m of stuck) {
    const asset = m.providerAssetId
      ? await video.getAsset(m.providerAssetId).catch(() => undefined)
      : null;
    if (asset === undefined) continue;
    if (asset && asset.state !== 'processing') {
      await applyAsset(asset, deps);
      continue;
    }
    if (!asset || m.processing.updatedAt < new Date(now.getTime() - PROCESSING_STUCK_MS)) {
      const res = await Media.updateOne(
        { _id: m._id, 'processing.state': 'processing' },
        {
          $set: {
            'processing.state': 'failed',
            'processing.failureCode': 'processing_failed',
            'processing.failureMessage': 'Processing took too long',
            'processing.updatedAt': now,
          },
        },
      );
      if (res.modifiedCount === 1) report.processingFailed++;
    }
  }

  // 3. provider assets that should not exist any more
  const doomed = await Media.find({
    providerAssetId: { $type: 'string' },
    providerDeletedAt: null,
    $or: [
      {
        'processing.state': 'failed',
        'processing.updatedAt': { $lt: new Date(now.getTime() - 60 * MIN) },
      },
      { status: 'deleted' },
      { status: 'removed', updatedAt: { $lt: new Date(now.getTime() - REMOVED_RETENTION_MS) } },
    ],
  }).limit(200);
  for (const m of doomed) {
    try {
      await video.deleteAsset(m.providerAssetId!);
      await Media.updateOne({ _id: m._id }, { $set: { providerDeletedAt: now } });
      report.assetsDeleted++;
    } catch {
      report.assetDeleteErrors++;
    }
  }

  // 4. live sessions
  const stale = await LiveSession.find({
    state: { $in: ACTIVE_LIVE_STATES },
    $or: [
      {
        state: 'interrupted',
        lastDisconnectedAt: { $lt: new Date(now.getTime() - RECONNECT_GRACE_MS) },
      },
      { state: 'created', createdAt: { $lt: new Date(now.getTime() - UNSTARTED_TTL_MS) } },
      { state: 'live', startedAt: { $lt: new Date(now.getTime() - MAX_LIVE_DURATION_MS) } },
    ],
  }).limit(200);
  for (const s of stale) {
    if (await closeSession(s._id, 'timeout', video)) report.livesClosed++;
  }

  if (Object.values(report).some((n) => n > 0))
    await recordAudit({ actorId: null, action: 'media.cleanup', metadata: { ...report } });
  return report;
}
