import express, { Router, type Request } from 'express';
import { z } from 'zod';
import {
  cancelOrderSchema,
  createOrderSchema,
  farmOrderListQuerySchema,
  orderListQuerySchema,
  quoteRequestSchema,
  requoteSchema,
  shipOrderSchema,
  shipmentEventSchema,
} from '@farmplus/validation';
import type { AppContext } from '../../context';
import { parse, requireActor } from '../../lib/http';
import { parseObjectId } from '../../lib/object-id';
import { authenticate } from '../../middleware/authenticate';
import { rateLimits } from '../../middleware/rate-limit';
import { Order, Shipment } from '../../models';
import { createQuote } from '../shipping/quotes.service';
import {
  applyShipmentEvent,
  cancelOrder,
  confirmDelivery,
  createOrder,
  getOrder,
  listFarmOrders,
  listMyOrders,
  processOrder,
  requote,
  sellerShipmentEvent,
  shipOrder,
  type OrderDeps,
} from './orders.service';
import { signedWebhook } from './webhook-auth';

const id = (req: Request, name = 'id') =>
  parseObjectId((req.params as Record<string, unknown>)[name]);
const deps = (ctx: AppContext): OrderDeps => ({ masterKey: ctx.mfaKey });

/** `/api/v1/orders` — the buyer's and the seller side's view of an order. Every route resolves the caller's party first. */
export function ordersRouter(ctx: AppContext): Router {
  const router = Router();
  const limits = rateLimits(ctx.env);
  const d = deps(ctx);
  router.use(authenticate(ctx));

  router.post('/', limits.order, async (req, res) => {
    res
      .status(201)
      .json({ order: await createOrder(requireActor(req), parse(createOrderSchema, req.body), d) });
  });
  router.get('/', async (req, res) => {
    res.json(await listMyOrders(requireActor(req), parse(orderListQuerySchema, req.query), d));
  });
  router.get('/:id', async (req, res) => {
    res.setHeader('cache-control', 'no-store'); // may contain the delivery address
    res.json({ order: await getOrder(requireActor(req), id(req), d) });
  });
  router.post('/:id/cancel', limits.order, async (req, res) => {
    res.json({
      order: await cancelOrder(
        requireActor(req),
        id(req),
        parse(cancelOrderSchema, req.body).reason,
        d,
      ),
    });
  });
  router.post('/:id/requote', limits.order, async (req, res) => {
    res.json({
      order: await requote(requireActor(req), id(req), parse(requoteSchema, req.body), d),
    });
  });
  router.post('/:id/confirm-delivery', limits.order, async (req, res) => {
    res.json({ order: await confirmDelivery(requireActor(req), id(req), d) });
  });
  router.post('/:id/process', limits.order, async (req, res) => {
    res.json({ order: await processOrder(requireActor(req), id(req), d) });
  });
  router.post('/:id/ship', limits.order, async (req, res) => {
    res.json({
      order: await shipOrder(requireActor(req), id(req), parse(shipOrderSchema, req.body), d),
    });
  });
  router.post('/:id/shipments/:shipmentId/events', limits.order, async (req, res) => {
    res.json({
      order: await sellerShipmentEvent(
        requireActor(req),
        id(req),
        id(req, 'shipmentId'),
        parse(shipmentEventSchema, req.body),
        d,
      ),
    });
  });
  return router;
}

/** `/api/v1/shipping` — quotes. */
export function shippingRouter(ctx: AppContext): Router {
  const router = Router();
  const limits = rateLimits(ctx.env);
  router.use(authenticate(ctx));
  router.post('/quotes', limits.quote, async (req, res) => {
    res.status(201).json({
      quote: await createQuote(
        requireActor(req),
        parse(quoteRequestSchema, req.body),
        ctx.shipping,
      ),
    });
  });
  return router;
}

/** `/api/v1/farms/:farmId/orders` — the seller's order inbox. */
export function farmOrdersRouter(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.get('/', async (req, res) => {
    res.json(
      await listFarmOrders(
        requireActor(req),
        id(req, 'farmId'),
        parse(farmOrderListQuerySchema, req.query),
        deps(ctx),
      ),
    );
  });
  return router;
}

// ---------------------------------------------------------------------------
// Provider callbacks. Raw body + HMAC; disabled (404) when the secret is not configured.
// ---------------------------------------------------------------------------
const shipmentCallbackSchema = z.object({
  type: z.literal('shipment.status'),
  carrier: z.string().min(2).max(80),
  trackingNumber: z.string().min(4).max(40),
  status: z.enum(['in_transit', 'out_for_delivery', 'delivered', 'failed', 'returned']),
  location: z.string().max(100).optional(),
  note: z.string().max(300).optional(),
});

export function commerceWebhookRouter(ctx: AppContext): Router {
  const router = Router();

  router.post(
    '/shipping',
    express.raw({ type: () => true, limit: '100kb' }),
    signedWebhook(ctx.env.SHIPPING_WEBHOOK_SECRET, 'shipping', async (body) => {
      const parsed = shipmentCallbackSchema.safeParse(body);
      if (!parsed.success) return { result: 'ignored' };
      const e = parsed.data;
      const shipment = await Shipment.findOne({
        carrier: e.carrier,
        trackingNumber: e.trackingNumber,
      });
      if (!shipment) return { result: 'unknown_shipment' };
      const order = await Order.findById(shipment.orderId);
      if (!order || order.status !== 'SHIPPED') return { result: 'order_not_in_transit' };
      const r = await applyShipmentEvent(shipment, e.status, 'provider', null, {
        note: e.note,
        location: e.location,
      });
      return { result: r.applied ? 'applied' : 'ignored' };
    }),
  );
  return router;
}
