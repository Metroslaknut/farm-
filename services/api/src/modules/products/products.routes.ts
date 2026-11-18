import { Router, type Request, type Response } from 'express';
import {
  cartQuerySchema,
  categoryKeySchema,
  categorySalesSchema,
  checkoutCartSchema,
  createProductSchema,
  createReviewSchema,
  farmProductsQuerySchema,
  moderationProductsQuerySchema,
  movementsQuerySchema,
  productOptionalReasonSchema,
  productReasonSchema,
  reviewsQuerySchema,
  setCartItemSchema,
  shopSearchSchema,
  stockAdjustSchema,
  updateProductSchema,
  upsertCategorySchema,
} from '@farmplus/validation';
import type { AppContext } from '../../context';
import { HttpError, notFound } from '../../lib/errors';
import { parse, requireActor } from '../../lib/http';
import { parseObjectId } from '../../lib/object-id';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/authorize';
import { rateLimits } from '../../middleware/rate-limit';
import { assertFarmActive } from '../farms/farm-access';
import { farmContext } from '../farms/farms.controller';
import { toProductDTOs } from './products.service';
import { Product } from '../../models';
import { checkoutCart, clearCart, getCart, removeCartItem, setCartItem } from './cart.service';
import { setCategorySales, upsertCategory } from './categories.service';
import { adjustStock, listMovements } from './inventory.service';
import {
  approveProduct,
  archiveProduct,
  createProduct,
  getFarmProduct,
  listFarmProducts,
  listForModeration,
  pauseProduct,
  rejectProduct,
  rescanProducts,
  restoreProduct,
  resumeProduct,
  submitProduct,
  suspendProduct,
  updateProduct,
} from './products.service';
import { createReview, deleteMyReview, listReviews, setReviewHidden } from './reviews.service';
import { getProduct, listCategories, searchProducts } from './shop.service';

const id = (req: Request, name = 'id') =>
  parseObjectId((req.params as Record<string, unknown>)[name]);
const policy = (ctx: AppContext) => ({
  allowedHosts: ctx.env.MEDIA_ALLOWED_HOSTS,
  production: ctx.env.NODE_ENV === 'production',
});

/** `/api/v1/shop` — browse, cart, checkout, reviews, and (permissioned) moderation and category compliance. */
export function shopRouter(ctx: AppContext): Router {
  const router = Router();
  const limits = rateLimits(ctx.env);
  router.use(authenticate(ctx));

  router.get('/categories', async (_req, res) => {
    res.json({ categories: await listCategories() });
  });
  router.get('/products', async (req, res) => {
    res.json(await searchProducts(requireActor(req), parse(shopSearchSchema, req.query)));
  });
  router.get('/products/:id', async (req, res) => {
    res.json({ product: await getProduct(requireActor(req), id(req)) });
  });

  // ---- reviews
  router.get('/products/:id/reviews', async (req, res) => {
    res.json(await listReviews(requireActor(req), id(req), parse(reviewsQuerySchema, req.query)));
  });
  router.post('/products/:id/reviews', limits.review, async (req, res) => {
    res.status(201).json({
      review: await createReview(requireActor(req), id(req), parse(createReviewSchema, req.body)),
    });
  });
  router.delete('/products/:id/reviews/mine', limits.review, async (req, res) => {
    await deleteMyReview(requireActor(req), id(req));
    res.status(204).end();
  });

  // ---- cart (stores ids and quantities only; prices and stock are read live)
  router.get('/cart', async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.json({ cart: await getCart(requireActor(req), parse(cartQuerySchema, req.query)) });
  });
  router.put('/cart/items/:productId', limits.cart, async (req, res) => {
    const { quantity } = parse(setCartItemSchema, req.body);
    res.json({ cart: await setCartItem(requireActor(req), id(req, 'productId'), quantity) });
  });
  router.delete('/cart/items/:productId', limits.cart, async (req, res) => {
    res.json({ cart: await removeCartItem(requireActor(req), id(req, 'productId')) });
  });
  router.delete('/cart', limits.cart, async (req, res) => {
    res.json({ cart: await clearCart(requireActor(req)) });
  });
  router.post('/cart/checkout', limits.order, async (req, res) => {
    res.status(201).json(
      await checkoutCart(requireActor(req), parse(checkoutCartSchema, req.body), {
        masterKey: ctx.mfaKey,
      }),
    );
  });

  // ---- review moderation (platform permission `content.moderate`). Mounted on its own path BEFORE the product
  // moderation router, whose `listings.moderate` check would otherwise run first for every /moderation request.
  const content = Router();
  content.use(requirePermission('content.moderate'));
  content.post('/:id/hide', async (req, res) => {
    res.json({
      review: await setReviewHidden(
        requireActor(req),
        id(req),
        true,
        parse(productReasonSchema, req.body).reason,
      ),
    });
  });
  content.post('/:id/restore', async (req, res) => {
    res.json({ review: await setReviewHidden(requireActor(req), id(req), false) });
  });
  router.use('/moderation/reviews', content);

  // ---- moderation (platform permission `listings.moderate`, MFA-protected like every staff permission)
  const mod = Router();
  mod.use(requirePermission('listings.moderate'));
  mod.get('/products', async (req, res) => {
    res.json(
      await listForModeration(requireActor(req), parse(moderationProductsQuerySchema, req.query)),
    );
  });
  mod.get('/products/:id', async (req, res) => {
    const p = await Product.findById(id(req));
    if (!p) throw notFound('Product not found');
    res.json({ product: (await toProductDTOs(requireActor(req), [p]))[0] });
  });
  mod.post('/products/:id/approve', async (req, res) => {
    res.json({ product: await approveProduct(requireActor(req), id(req)) });
  });
  mod.post('/products/:id/reject', async (req, res) => {
    res.json({
      product: await rejectProduct(
        requireActor(req),
        id(req),
        parse(productReasonSchema, req.body).reason,
      ),
    });
  });
  mod.post('/products/:id/suspend', async (req, res) => {
    res.json({
      product: await suspendProduct(
        requireActor(req),
        id(req),
        parse(productReasonSchema, req.body).reason,
      ),
    });
  });
  mod.post('/products/:id/restore', async (req, res) => {
    res.json({ product: await restoreProduct(requireActor(req), id(req)) });
  });
  mod.post('/rescan', async (req, res) => {
    res.json(await rescanProducts(requireActor(req)));
  });
  router.use('/moderation', mod);

  // ---- category compliance (platform permission `settings.manage`)
  const adminCat = Router();
  adminCat.use(requirePermission('settings.manage'));
  adminCat.put('/categories/:key', limits.money, async (req, res) => {
    const key = parse(categoryKeySchema, req.params['key']);
    res.json({
      category: await upsertCategory(requireActor(req), key, parse(upsertCategorySchema, req.body)),
    });
  });
  adminCat.post('/categories/:key/sales', limits.money, async (req, res) => {
    const key = parse(categoryKeySchema, req.params['key']);
    res.json({
      category: await setCategorySales(
        requireActor(req),
        key,
        parse(categorySalesSchema, req.body),
      ),
    });
  });
  router.use('/admin', adminCat);
  return router;
}

/** Nested under `/farms/:farmId/products`: the seller side. Every lookup includes the farm id (IDOR-safe). */
export function farmProductsRouter(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  const limits = rateLimits(ctx.env);

  router.post('/', limits.listing, async (req, res) => {
    const { actor, access } = await farmContext(req);
    res.status(201).json({
      product: await createProduct(
        actor,
        access,
        parse(createProductSchema, req.body),
        policy(ctx),
      ),
    });
  });
  router.get('/', async (req, res) => {
    const { actor, access } = await farmContext(req);
    res.json(await listFarmProducts(actor, access, parse(farmProductsQuerySchema, req.query)));
  });
  router.get('/:id', async (req, res) => {
    const { actor, access } = await farmContext(req);
    res.json(await getFarmProduct(actor, access, id(req)));
  });
  router.patch('/:id', async (req, res) => {
    const { actor, access } = await farmContext(req);
    res.json({
      product: await updateProduct(
        actor,
        access,
        id(req),
        parse(updateProductSchema, req.body),
        policy(ctx),
      ),
    });
  });
  const action =
    (
      fn: (
        a: Parameters<typeof submitProduct>[0],
        b: Parameters<typeof submitProduct>[1],
        c: Parameters<typeof submitProduct>[2],
      ) => Promise<unknown>,
    ) =>
    async (req: Request, res: Response) => {
      const { actor, access } = await farmContext(req);
      parse(productOptionalReasonSchema, req.body ?? {});
      res.json({ product: await fn(actor, access, id(req)) });
    };
  router.post('/:id/submit', action(submitProduct));
  router.post('/:id/pause', action(pauseProduct));
  router.post('/:id/resume', action(resumeProduct));
  router.post('/:id/archive', action(archiveProduct));

  router.post('/:id/stock', limits.listing, async (req, res) => {
    const { actor, access } = await farmContext(req);
    const input = parse(stockAdjustSchema, req.body);
    const { product } = await getFarmProduct(actor, access, id(req)); // also proves farm ownership and permission
    // Archived farms and archived products are frozen, like every other seller write.
    assertFarmActive(access);
    if (product.status === 'ARCHIVED')
      throw new HttpError(409, 'NOT_EDITABLE', 'An archived product cannot be changed');
    await adjustStock(actor, parseObjectId(product.id), access.farm._id, input);
    res.json(await getFarmProduct(actor, access, id(req)));
  });
  router.get('/:id/movements', async (req, res) => {
    const { actor, access } = await farmContext(req);
    await getFarmProduct(actor, access, id(req));
    res.json(await listMovements(id(req), parse(movementsQuerySchema, req.query)));
  });
  return router;
}
