import { Router, type Request, type Response } from 'express';
import {
  acceptSchema,
  counterSchema,
  createListingSchema,
  createOfferSchema,
  listingSearchSchema,
  moderationListQuerySchema,
  optionalReasonSchema,
  pageQuerySchema,
  reasonSchema,
  rejectOfferSchema,
  sellerListingsQuerySchema,
  updateListingSchema,
} from '@farmplus/validation';
import { NEGOTIATION_STATUSES } from '@farmplus/shared-types';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { parse, requireActor } from '../../lib/http';
import { parseObjectId } from '../../lib/object-id';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { rateLimits } from '../../middleware/rate-limit';
import { farmContext } from '../farms/farms.controller';
import { runOrdersCleanup } from '../orders/orders.service';
import { runMarketplaceCleanup } from './cleanup.service';
import {
  approveListing,
  cancelListing,
  createListing,
  favorite,
  farmListingEvents,
  getFarmListing,
  getListing,
  listFarmListings,
  listFavorites,
  listForModeration,
  markSold,
  moderationEvents,
  pauseListing,
  rejectListing,
  renewListing,
  resumeListing,
  restoreListing,
  searchListings,
  submitListing,
  suspendListing,
  unfavorite,
  updateListing,
} from './listings.service';
import {
  accept,
  cancelReservation,
  counter,
  getNegotiation,
  listFarmNegotiations,
  listMyNegotiations,
  reject,
  startNegotiation,
} from './negotiations.service';

const id = (req: Request, name = 'id') => parseObjectId(req.params[name]);
const policy = (ctx: AppContext) => ({
  allowedHosts: ctx.env.MEDIA_ALLOWED_HOSTS,
  production: ctx.env.NODE_ENV === 'production',
});

/** `/api/v1/marketplace` — browsing, favourites, offers (buyer + seller side) and moderation. */
export function marketplaceRouter(ctx: AppContext): Router {
  const router = Router();
  const limits = rateLimits(ctx.env);
  router.use(authenticate(ctx));

  // ---- browse
  router.get('/listings', async (req, res) => {
    res.json(await searchListings(requireActor(req), parse(listingSearchSchema, req.query)));
  });
  router.get('/listings/:id', async (req, res) => {
    res.json({ listing: await getListing(requireActor(req), id(req)) });
  });
  router.get('/favorites', async (req, res) => {
    res.json(await listFavorites(requireActor(req), parse(pageQuerySchema, req.query)));
  });
  router.post('/listings/:id/favorite', limits.react, async (req, res) => {
    res.json(await favorite(requireActor(req), id(req)));
  });
  router.delete('/listings/:id/favorite', limits.react, async (req, res) => {
    res.json(await unfavorite(requireActor(req), id(req)));
  });

  // ---- negotiations
  router.post('/listings/:id/negotiations', limits.offer, async (req, res) => {
    res.status(201).json({
      negotiation: await startNegotiation(
        requireActor(req),
        id(req),
        parse(createOfferSchema, req.body),
      ),
    });
  });
  router.get('/negotiations', async (req, res) => {
    res.json(await listMyNegotiations(requireActor(req), parse(pageQuerySchema, req.query)));
  });
  router.get('/negotiations/:id', async (req, res) => {
    res.json({ negotiation: await getNegotiation(requireActor(req), id(req)) });
  });
  router.post('/negotiations/:id/counter', limits.offer, async (req, res) => {
    res.json({
      negotiation: await counter(requireActor(req), id(req), parse(counterSchema, req.body)),
    });
  });
  router.post('/negotiations/:id/accept', limits.offer, async (req, res) => {
    res.json({
      negotiation: await accept(requireActor(req), id(req), parse(acceptSchema, req.body)),
    });
  });
  router.post('/negotiations/:id/reject', limits.offer, async (req, res) => {
    res.json({
      negotiation: await reject(
        requireActor(req),
        id(req),
        parse(rejectOfferSchema, req.body ?? {}),
      ),
    });
  });
  router.post('/negotiations/:id/withdraw', limits.offer, async (req, res) => {
    res.json({
      negotiation: await reject(
        requireActor(req),
        id(req),
        parse(rejectOfferSchema, req.body ?? {}),
      ),
    });
  });
  router.post('/negotiations/:id/cancel-reservation', limits.offer, async (req, res) => {
    res.json({
      negotiation: await cancelReservation(
        requireActor(req),
        id(req),
        parse(optionalReasonSchema, req.body ?? {}),
      ),
    });
  });

  // ---- moderation (platform permission `listings.moderate`, MFA-protected like every staff permission)
  const mod = Router();
  mod.use(requirePermission('listings.moderate'));
  mod.get('/listings', async (req, res) => {
    res.json(
      await listForModeration(requireActor(req), parse(moderationListQuerySchema, req.query)),
    );
  });
  mod.get('/listings/:id/events', async (req, res) => {
    res.json({ events: await moderationEvents(id(req)) });
  });
  mod.post('/listings/:id/approve', async (req, res) => {
    res.json({ listing: await approveListing(requireActor(req), id(req)) });
  });
  mod.post('/listings/:id/reject', async (req, res) => {
    res.json({
      listing: await rejectListing(
        requireActor(req),
        id(req),
        parse(reasonSchema, req.body).reason,
      ),
    });
  });
  mod.post('/listings/:id/suspend', async (req, res) => {
    res.json({
      listing: await suspendListing(
        requireActor(req),
        id(req),
        parse(reasonSchema, req.body).reason,
      ),
    });
  });
  mod.post('/listings/:id/restore', async (req, res) => {
    res.json({ listing: await restoreListing(requireActor(req), id(req)) });
  });
  mod.post('/cleanup', async (_req, res) => {
    res.json({
      ...(await runMarketplaceCleanup()),
      ...(await runOrdersCleanup(new Date(), ctx.payments)),
    });
  });
  router.use('/moderation', mod);
  return router;
}

const negotiationQuery = pageQuerySchema.extend({
  listingId: z
    .string()
    .regex(/^[0-9a-f]{24}$/)
    .optional(),
  status: z.enum(NEGOTIATION_STATUSES).optional(),
});

/** Nested under `/farms/:farmId`: the seller's side. Every lookup includes the farm id (IDOR-safe). */
export function farmListingsRouter(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  const limits = rateLimits(ctx.env);

  router.post('/', limits.listing, async (req, res) => {
    const { actor, access } = await farmContext(req);
    res.status(201).json({
      listing: await createListing(
        actor,
        access,
        parse(createListingSchema, req.body),
        policy(ctx),
      ),
    });
  });
  router.get('/', async (req, res) => {
    const { actor, access } = await farmContext(req);
    res.json(await listFarmListings(actor, access, parse(sellerListingsQuerySchema, req.query)));
  });
  router.get('/:id', async (req, res) => {
    const { actor, access } = await farmContext(req);
    res.json({ listing: await getFarmListing(actor, access, id(req)) });
  });
  router.patch('/:id', async (req, res) => {
    const { actor, access } = await farmContext(req);
    res.json({
      listing: await updateListing(
        actor,
        access,
        id(req),
        parse(updateListingSchema, req.body),
        policy(ctx),
      ),
    });
  });
  const action =
    (
      fn: (
        a: Parameters<typeof submitListing>[0],
        b: Parameters<typeof submitListing>[1],
        c: Parameters<typeof submitListing>[2],
        reason?: string,
      ) => Promise<unknown>,
    ) =>
    async (req: Request, res: Response) => {
      const { actor, access } = await farmContext(req);
      const { reason } = parse(optionalReasonSchema, req.body ?? {});
      res.json({ listing: await fn(actor, access, id(req), reason) });
    };
  router.post(
    '/:id/submit',
    action((a, b, c) => submitListing(a, b, c)),
  );
  router.post('/:id/pause', action(pauseListing));
  router.post(
    '/:id/resume',
    action((a, b, c) => resumeListing(a, b, c)),
  );
  router.post(
    '/:id/renew',
    action((a, b, c) => renewListing(a, b, c)),
  );
  router.post('/:id/cancel', action(cancelListing));
  router.post(
    '/:id/sold',
    action((a, b, c) => markSold(a, b, c)),
  );
  router.get('/:id/events', async (req, res) => {
    const { access } = await farmContext(req);
    res.json({ events: await farmListingEvents(access, id(req)) });
  });
  return router;
}

/** `/farms/:farmId/negotiations` — the seller's inbox. */
export function farmNegotiationsRouter(): Router {
  const router = Router({ mergeParams: true });
  router.get('/', async (req, res) => {
    const q = parse(negotiationQuery, req.query);
    res.json(
      await listFarmNegotiations(
        requireActor(req),
        parseObjectId((req.params as Record<string, unknown>)['farmId']),
        {
          ...q,
          listingId: q.listingId ? parseObjectId(q.listingId) : undefined,
        },
      ),
    );
  });
  return router;
}
