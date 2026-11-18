import { Listing } from '../../models';
import { recordAudit } from '../../services/audit.service';

import { transition } from './listings.service';
import {
  cancelOpenNegotiations,
  expireStaleOffers,
  releaseStaleReservations,
} from './negotiations.service';

export interface MarketplaceCleanupReport {
  offersExpired: number;
  listingsExpired: number;
  reservationsReleased: number;
}

/**
 * Time-based housekeeping (idempotent, safe on several instances): offers past their expiry, listings past theirs,
 * and accepted deals whose reservation window ran out without the sale being completed.
 */
export async function runMarketplaceCleanup(now = new Date()): Promise<MarketplaceCleanupReport> {
  const report: MarketplaceCleanupReport = {
    offersExpired: 0,
    listingsExpired: 0,
    reservationsReleased: 0,
  };
  report.reservationsReleased = await releaseStaleReservations(now);
  report.offersExpired = await expireStaleOffers(now);
  const due = await Listing.find({ status: 'ACTIVE', expiresAt: { $lte: now } }).limit(200);
  for (const l of due) {
    const done = await transition(l._id, ['ACTIVE'], 'EXPIRED', null, 'expired', {
      extraFilter: { expiresAt: { $lte: now } },
    });
    if (done) {
      await cancelOpenNegotiations(l._id, 'listing_expired');
      report.listingsExpired++;
    }
  }
  if (Object.values(report).some((n) => n > 0))
    await recordAudit({ actorId: null, action: 'marketplace.cleanup', metadata: { ...report } });
  return report;
}
