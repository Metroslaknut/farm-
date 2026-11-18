/* eslint-disable @typescript-eslint/no-explicit-any -- responses are inspected loosely in tests */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AuditLog,
  FinancialAuditLog,
  Order,
  Payment,
  Refund,
  Wallet,
  WalletTransaction,
} from '../../src/models';
import { SHIPPING } from '../commerce-fixtures';
import { key, payOrder, providerEvent, send } from '../finance-helpers';
import {
  createStaff,
  daysAgo,
  PASSWORD,
  startHarness,
  uniqueEmail,
  type Session,
  type Staff,
  type TestHarness,
} from '../helpers';
import { ADDRESS } from '../orders-helpers';
import { findSecrets } from '../qa/secret-scan';
import { PRODUCT, sku } from '../shop-fixtures';
import { readyVideo } from '../video-helpers';

/**
 * PART 20 — final acceptance. ONE continuous journey through the real HTTP API (no direct database writes for business
 * actions), following the twenty scenarios of the acceptance plan, with the platform's own rules switched on: e-mail
 * verification required, listing/product review on, a 5 % commission rule. Each scenario records its evidence; after the run
 * the evidence is written to docs/acceptance/evidence/api-journey.json.
 */
let h: TestHarness;
const V = (p: string) => `/api/v1${p}`;
const evidence: {
  scenario: string;
  title: string;
  checks: string[];
  ids?: Record<string, string>;
}[] = [];
const note = (scenario: string, title: string, checks: string[], ids?: Record<string, string>) =>
  evidence.push({ scenario, title, checks, ...(ids ? { ids } : {}) });

type Verb = 'get' | 'post' | 'put' | 'patch' | 'delete';
const call = (
  m: Verb,
  s: Session | null,
  path: string,
  body?: object,
  headers: Record<string, string> = {},
) => {
  const r = request(h.app)[m](V(path));
  if (s) r.set(s.auth);
  for (const [k, v] of Object.entries(headers)) r.set(k, v);
  return m === 'get' || m === 'delete' ? r : r.send(body ?? {});
};
const ok = async (p: Promise<request.Response>, status: number | number[] = [200, 201, 204]) => {
  const res = await p;
  const allowed = Array.isArray(status) ? status : [status];
  expect(
    allowed,
    `${res.request.method} ${res.request.url} → ${res.status} ${JSON.stringify(res.body)}`,
  ).toContain(res.status);
  return res;
};

/** Sign up through the real flow: register → sign-in is refused until the e-mail link is used → verify → sign in. */
async function signUp(name: string): Promise<Session & { email: string }> {
  const email = uniqueEmail('journey');
  await ok(
    call('post', null, '/auth/register', { email, password: PASSWORD, displayName: name }),
    201,
  );
  const early = await call('post', null, '/auth/login', { identifier: email, password: PASSWORD });
  expect(early.status).toBe(403);
  expect(early.body.error.code).toBe('ACCOUNT_NOT_VERIFIED');
  const mail = h.notifier.last('verify_email')!;
  expect(mail.to).toBe(email);
  await ok(call('post', null, '/auth/verify/email', { token: mail.secret }), 204);
  const res = await ok(
    call('post', null, '/auth/login', { identifier: email, password: PASSWORD }),
    200,
  );
  const t = res.body.tokens;
  return {
    id: res.body.user.id,
    email,
    accessToken: t.accessToken,
    refreshToken: t.refreshToken,
    auth: { Authorization: `Bearer ${t.accessToken}` },
  };
}

let moderator: Staff;
let finance: Staff;
let admin: Staff;
let registrar: Staff;
let farmer: Session & { email: string };
let buyer: Session & { email: string };
let neighbour: Session & { email: string };
const S: Record<string, any> = {};

beforeAll(async () => {
  h = await startHarness({ AUTH_REQUIRE_VERIFICATION: 'true' });
  moderator = await createStaff(h.app, ['moderator']);
  finance = await createStaff(h.app, ['finance_admin']);
  admin = await createStaff(h.app, ['super_admin']);
  registrar = await createStaff(h.app, ['registration_admin']);
  await ok(
    call('post', finance, '/admin/finance/commission-rules', {
      name: 'Journey 5%',
      feeBps: 500,
      categories: [],
      startsAt: '2020-01-01T00:00:00.000Z',
      priority: 10,
      reason: 'Acceptance run pricing',
    }),
    201,
  );
});
afterAll(async () => {
  const dir = join(process.cwd(), '../../docs/acceptance/evidence');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'api-journey.json'),
    `${JSON.stringify({ generatedBy: 'services/api/test/acceptance/journey.test.ts', when: new Date().toISOString(), scenarios: evidence }, null, 2)}\n`,
  );
  await h.stop();
});

/** A further sellable animal + accepted deal (pickup), for the refund scenario. */
async function listedAndAccepted(farmId: string, code: string, price: number) {
  const animal = (
    await ok(
      call('post', farmer, `/farms/${farmId}/animals`, {
        animalCode: code,
        animalTypeId: S.typeId,
        sex: 'female',
        birthDate: '2022-03-15',
      }),
      201,
    )
  ).body.animal;
  const listing = (
    await ok(
      call('post', farmer, `/farms/${farmId}/listings`, {
        animalId: animal.id,
        title: `Buffalo ${code}`,
        askingPriceMinor: price,
        negotiable: false,
        photos: [{ url: 'https://cdn.example.test/a.jpg' }],
        deliveryOptions: ['pickup'],
      }),
      201,
    )
  ).body.listing;
  await ok(call('post', farmer, `/farms/${farmId}/listings/${listing.id}/submit`), 200);
  await ok(call('post', moderator, `/marketplace/moderation/listings/${listing.id}/approve`), 200);
  const neg = (
    await ok(
      call('post', buyer, `/marketplace/listings/${listing.id}/negotiations`, {
        amountMinor: price,
      }),
      201,
    )
  ).body.negotiation;
  await ok(
    call('post', farmer, `/marketplace/negotiations/${neg.id}/accept`, { expectedSeq: 1 }),
    200,
  );
  return { listing, neg };
}

describe('PART 20 — the twenty acceptance scenarios, in order', () => {
  it('1. Register users and verify their accounts (sign-in refused until the link is used; the link works once)', async () => {
    farmer = await signUp('Somchai Farmer');
    buyer = await signUp('Nok Buyer');
    neighbour = await signUp('Neighbour Farmer');
    const me = (await ok(call('get', farmer, '/auth/me'), 200)).body;
    expect(me.user).toMatchObject({ displayName: 'Somchai Farmer', emailVerified: true });
    expect(me.permissions).toEqual([]);
    expect(
      (
        await call('post', null, '/auth/verify/email', {
          token: h.notifier.last('verify_email')!.secret,
        })
      ).status,
    ).toBe(400);
    note(
      '1',
      'Register and verify',
      [
        'sign-in refused with ACCOUNT_NOT_VERIFIED before verification',
        'verification link accepted once, refused on reuse',
        'new account has no permissions',
      ],
      { farmerId: farmer.id, buyerId: buyer.id },
    );
  });

  it('2. Approve the required permissions: identity → farm-owner → seller registrations, reviewed by staff with recorded reasons', async () => {
    expect((await call('post', farmer, '/farms', { name: 'Too Early Farm' })).status).toBe(403);
    const approve = async (type: string, documents: object[] = []) => {
      const created = (await ok(call('post', farmer, '/registrations', { type, documents }), 201))
        .body.registration;
      await ok(call('post', registrar, `/admin/registrations/${created.id}/review`), 200);
      const done = await ok(
        call('post', registrar, `/admin/registrations/${created.id}/approve`, {
          reason: `Checked ${type} documents`,
        }),
        200,
      );
      expect(done.body.registration.status).toBe('APPROVED');
      return created.id as string;
    };
    S.regIds = [
      await approve('identity', [
        { kind: 'national_id', url: 'https://files.example.test/id.png' },
      ]),
      await approve('farm_owner'),
      await approve('seller'),
    ];
    const me = (await ok(call('get', farmer, '/auth/me'), 200)).body;
    expect(me.user.roles).toEqual(expect.arrayContaining(['farm_owner', 'seller']));
    expect(
      (
        await call('post', farmer, `/admin/registrations/${S.regIds[0]}/approve`, {
          reason: 'self approval',
        })
      ).status,
    ).toBe(403);
    const n = (await ok(call('post', neighbour, '/registrations', { type: 'farm_owner' }), 201))
      .body.registration;
    await ok(call('post', registrar, `/admin/registrations/${n.id}/review`), 200);
    await ok(
      call('post', registrar, `/admin/registrations/${n.id}/approve`, {
        reason: 'Checked farm owner',
      }),
      200,
    );
    note(
      '2',
      'Permissions via approved registrations',
      [
        'farm creation refused (403) before approval',
        'identity, farm_owner and seller registrations approved by staff with reasons',
        'roles appear on the account',
        'self-approval refused',
      ],
      { identityRegistration: S.regIds[0] },
    );
  });

  it('3. Create a farm', async () => {
    const farm = (
      await ok(
        call('post', farmer, '/farms', {
          name: 'Happy Buffalo Farm',
          description: 'Acceptance test farm',
        }),
        201,
      )
    ).body.farm;
    S.farmId = farm.id;
    expect(farm).toMatchObject({ name: 'Happy Buffalo Farm' });
    S.otherFarmId = (
      await ok(call('post', neighbour, '/farms', { name: 'Neighbour Farm' }), 201)
    ).body.farm.id;
    const list = JSON.stringify((await ok(call('get', farmer, '/farms'))).body);
    expect(list).toContain('Happy Buffalo Farm');
    expect(list).not.toContain('Neighbour Farm');
    note(
      '3',
      'Create a farm',
      ['farm created by an approved farm owner', 'farm list shows own farms only'],
      { farmId: S.farmId },
    );
  });

  it('4. Register an animal', async () => {
    const types = (await ok(call('get', farmer, '/animal-types'))).body.animalTypes;
    S.typeId = types.find((t: any) => t.key === 'buffalo').id;
    const animal = (
      await ok(
        call('post', farmer, `/farms/${S.farmId}/animals`, {
          animalCode: 'BUF-001',
          name: 'Dao',
          animalTypeId: S.typeId,
          sex: 'female',
          birthDate: '2022-03-15',
          breed: 'swamp',
        }),
        201,
      )
    ).body.animal;
    S.animalId = animal.id;
    expect(animal).toMatchObject({ animalCode: 'BUF-001' });
    expect(
      (
        await call('post', farmer, `/farms/${S.farmId}/animals`, {
          animalCode: 'BUF-001',
          animalTypeId: S.typeId,
          sex: 'female',
        })
      ).status,
    ).toBe(409);
    note(
      '4',
      'Register an animal',
      ['animal created', 'duplicate code on the same farm refused (409)'],
      { animalId: S.animalId },
    );
  });

  it('5. Record growth, feeding, health and cost history, and read it back', async () => {
    const f = `/farms/${S.farmId}`;
    await ok(
      call('post', farmer, `${f}/weights`, {
        animalId: S.animalId,
        weighedOn: daysAgo(30),
        weightKg: 300,
        method: 'scale',
      }),
      201,
    );
    await ok(
      call('post', farmer, `${f}/weights`, {
        animalId: S.animalId,
        weighedOn: daysAgo(1),
        weightKg: 330,
        method: 'scale',
      }),
      201,
    );
    await ok(
      call('post', farmer, `${f}/feeding`, {
        kind: 'log',
        animalId: S.animalId,
        date: daysAgo(1),
        feedName: 'Napier grass',
        category: 'roughage',
        quantity: { amount: 12, unit: 'kg' },
      }),
      201,
    );
    await ok(
      call('post', farmer, `${f}/health`, {
        animalId: S.animalId,
        type: 'vaccination',
        recordedOn: daysAgo(10),
        title: 'FMD vaccine',
        vaccine: { name: 'FMD' },
      }),
      201,
    );
    await ok(
      call('post', farmer, `${f}/expenses`, {
        animalId: S.animalId,
        category: 'feed',
        expenseDate: daysAgo(5),
        amount: 1500,
        description: 'Feed',
      }),
      201,
    );
    expect(
      (await ok(call('get', farmer, `${f}/weights?animalId=${S.animalId}`))).body.items,
    ).toHaveLength(2);
    expect(
      (await ok(call('get', farmer, `${f}/feeding?animalId=${S.animalId}`))).body.items,
    ).toHaveLength(1);
    expect(
      (await ok(call('get', farmer, `${f}/health?animalId=${S.animalId}`))).body.items,
    ).toHaveLength(1);
    note(
      '5',
      'Growth, feeding, health, cost records',
      ['2 weighings, 1 feeding log, 1 health record and 1 expense stored and listed'],
      { animalId: S.animalId },
    );
  });

  it('6. Generate an AI assessment: calculated figures, disclaimer, nothing invented, the owner decides', async () => {
    const a = (
      await ok(
        call('post', farmer, `/farms/${S.farmId}/animals/${S.animalId}/assessments`, {
          includeAiExplanation: true,
        }),
        201,
      )
    ).body.assessment;
    expect(a.disclaimer).toContain('not veterinary diagnosis');
    expect(a.review.status).toBe('pending');
    expect(a.readinessScore).toBeNull();
    S.assessmentId = a.id;
    const accepted = await ok(
      call('post', farmer, `/farms/${S.farmId}/assessments/${a.id}/review`, {
        decision: 'accepted',
        note: 'Looks right',
      }),
      200,
    );
    expect(accepted.body.assessment.review.status).toBe('accepted');
    expect((await call('get', neighbour, `/farms/${S.farmId}/assessments/${a.id}`)).status).toBe(
      404,
    );
    note(
      '6',
      'AI assessment',
      [
        'assessment generated with disclaimer; no score invented without validated criteria',
        'owner accepted it; another farm cannot read it',
      ],
      { assessmentId: a.id },
    );
  });

  it('7. Publish a community post, see it in another user’s feed, react and comment', async () => {
    const post = (
      await ok(call('post', farmer, '/posts', { body: 'Our calf Dao is thriving!' }), 201)
    ).body.post;
    S.postId = post.id;
    expect(JSON.stringify((await ok(call('get', buyer, '/posts'))).body)).toContain(
      'Our calf Dao is thriving',
    );
    await ok(call('post', buyer, `/posts/${post.id}/reactions`, { type: 'like' }));
    await ok(call('post', buyer, `/posts/${post.id}/comments`, { body: 'Beautiful animal' }), 201);
    expect((await ok(call('get', farmer, `/posts/${post.id}/comments`))).body.items).toHaveLength(
      1,
    );
    note(
      '7',
      'Community post',
      ['post published and visible in another user’s feed', 'reaction and comment stored'],
      { postId: post.id },
    );
  });

  it('8. Upload and view a short video (ticket → upload → processed → playback → view counted)', async () => {
    const videoId = await readyVideo(h.app, farmer, { title: 'Dao in the field' });
    S.videoId = videoId;
    const play = await ok(call('get', buyer, `/videos/${videoId}/playback`), 200);
    expect(play.body.url).toMatch(/^https?:\/\//);
    await ok(call('post', buyer, `/videos/${videoId}/views`, { watchedSeconds: 12 }));
    expect(JSON.stringify((await ok(call('get', buyer, '/videos'))).body)).toContain(
      'Dao in the field',
    );
    expect(
      (
        await call('post', null, '/videos/uploads', {
          title: 'x',
          filename: 'a.mp4',
          mimeType: 'video/mp4',
          sizeBytes: 10,
        })
      ).status,
    ).toBe(401);
    note(
      '8',
      'Short video',
      [
        'upload ticket, provider upload and processing → ready',
        'playback URL issued to another user, view recorded, video listed',
        'anonymous upload refused',
      ],
      { videoId },
    );
  });

  it('9. Create an animal listing, submit it, and have a moderator approve it', async () => {
    const listing = (
      await ok(
        call('post', farmer, `/farms/${S.farmId}/listings`, {
          animalId: S.animalId,
          title: 'Swamp buffalo cow Dao',
          description: 'Healthy, vaccinated',
          askingPriceMinor: 5_000_000,
          negotiable: true,
          minOfferMinor: 4_000_000,
          photos: [{ url: 'https://cdn.example.test/dao.jpg' }],
          deliveryOptions: ['pickup', 'delivery'],
          shipping: SHIPPING,
        }),
        201,
      )
    ).body.listing;
    S.listingId = listing.id;
    expect(listing.status).toBe('DRAFT');
    expect((await call('get', buyer, `/marketplace/listings/${listing.id}`)).status).toBe(404);
    await ok(call('post', farmer, `/farms/${S.farmId}/listings/${listing.id}/submit`), 200);
    expect(
      (await call('post', farmer, `/marketplace/moderation/listings/${listing.id}/approve`)).status,
    ).toBe(403);
    await ok(
      call('post', moderator, `/marketplace/moderation/listings/${listing.id}/approve`),
      200,
    );
    expect(
      (await ok(call('get', buyer, `/marketplace/listings/${listing.id}`))).body.listing,
    ).toMatchObject({ status: 'ACTIVE', askingPriceMinor: 5_000_000 });
    note(
      '9',
      'Listing',
      [
        'draft not visible to buyers',
        'submit → moderator approval (a seller cannot approve) → active and visible',
      ],
      { listingId: listing.id },
    );
  });

  it('10. Submit and accept a negotiation (offer → counter → accept); the animal is reserved', async () => {
    expect(
      (
        await call('post', buyer, `/marketplace/listings/${S.listingId}/negotiations`, {
          amountMinor: 3_000_000,
        })
      ).status,
    ).toBe(400);
    const neg = (
      await ok(
        call('post', buyer, `/marketplace/listings/${S.listingId}/negotiations`, {
          amountMinor: 4_000_000,
          message: 'Can you do 40,000?',
        }),
        201,
      )
    ).body.negotiation;
    S.negId = neg.id;
    const countered = await ok(
      call('post', farmer, `/marketplace/negotiations/${neg.id}/counter`, {
        amountMinor: 4_500_000,
        expectedSeq: 1,
      }),
      200,
    );
    expect(countered.body.negotiation).toMatchObject({
      currentOfferMinor: 4_500_000,
      turn: 'buyer',
    });
    expect(
      (await call('post', buyer, `/marketplace/negotiations/${neg.id}/accept`, { expectedSeq: 1 }))
        .status,
    ).toBe(409);
    expect(
      (
        await ok(
          call('post', buyer, `/marketplace/negotiations/${neg.id}/accept`, { expectedSeq: 2 }),
          200,
        )
      ).body.negotiation.status,
    ).toBe('accepted');
    expect(
      (await ok(call('get', buyer, `/marketplace/listings/${S.listingId}`))).body.listing.status,
    ).toBe('RESERVED');
    expect(
      (await ok(call('get', farmer, '/notifications?limit=50'))).body.items.map((n: any) => n.type),
    ).toContain('offer.received');
    note(
      '10',
      'Negotiation',
      [
        'offer below the seller’s floor refused',
        'counter-offer 45,000 ฿',
        'stale accept refused (409), current accept succeeds',
        'listing RESERVED',
        'seller notified',
      ],
      { negotiationId: neg.id },
    );
  });

  it('12. Calculate shipping from the seller’s own rates (done before the order, as the buyer does)', async () => {
    const quote = (
      await ok(
        call('post', buyer, '/shipping/quotes', {
          listingId: S.listingId,
          destination: { province: 'Bangkok' },
        }),
        201,
      )
    ).body.quote;
    S.quote = quote;
    const option = quote.options.find((o: any) => o.id === 'seller');
    expect(option.priceMinor).toBe(250_000);
    expect(option.isEstimate).toBe(true);
    const far = (
      await ok(
        call('post', buyer, '/shipping/quotes', {
          listingId: S.listingId,
          destination: { province: 'Chiang Mai' },
        }),
        201,
      )
    ).body.quote;
    expect(far.options.find((o: any) => o.id === 'seller').priceMinor).toBe(400_000);
    note(
      '12',
      'Shipping calculation',
      ['Bangkok 2,500 ฿ and Chiang Mai 4,000 ฿ from the seller’s rates', 'flagged as an estimate'],
      { quoteId: quote.id },
    );
  });

  it('11. Create the order from the accepted deal (delivery, quoted shipping, address encrypted at rest)', async () => {
    const order = (
      await ok(
        call(
          'post',
          buyer,
          '/orders',
          {
            negotiationId: S.negId,
            fulfillment: 'delivery',
            quoteId: S.quote.id,
            optionId: 'seller',
            address: ADDRESS,
            acknowledgeTransport: true,
          },
          { 'idempotency-key': key('order') },
        ),
        201,
      )
    ).body.order;
    S.order = order;
    expect(order.status).toBe('PENDING_PAYMENT');
    expect(order.totals).toMatchObject({
      itemsMinor: 4_500_000,
      shippingMinor: 250_000,
      grandTotalMinor: 4_750_000,
    });
    expect(
      (
        await call('post', buyer, '/orders', {
          negotiationId: S.negId,
          fulfillment: 'delivery',
          quoteId: S.quote.id,
          optionId: 'seller',
          address: ADDRESS,
          acknowledgeTransport: true,
        })
      ).status,
    ).toBe(409);
    expect(JSON.stringify(await Order.findById(order.id).lean())).not.toContain('Secret Street');
    note(
      '11',
      'Order',
      [
        'totals 45,000 + 2,500 shipping = 47,500 ฿',
        'one order per deal',
        'delivery address encrypted at rest',
      ],
      { orderId: order.id, orderNo: order.orderNo },
    );
  });

  it('13–15. Pay through the provider, apply the platform fee, verify the seller’s proceeds and the ledger', async () => {
    const paid = await payOrder(h, buyer, S.order);
    expect(paid.result).toBe('succeeded');
    S.paymentId = paid.payment.id;
    const order = (await ok(call('get', buyer, `/orders/${S.order.id}`))).body.order;
    expect(order.status).toBe('PAID');
    expect(order.totals).toMatchObject({ platformFeeMinor: 225_000, sellerPayoutMinor: 4_275_000 });
    expect((await Order.findById(S.order.id))!.feeSnapshot).toMatchObject({
      feeBps: 500,
      feeMinor: 225_000,
    });
    const lines = await WalletTransaction.find({ journalKey: `capture:${paid.payment.id}` }).sort({
      lineNo: 1,
    });
    expect(lines.map((l) => [l.walletKind, l.bucket, l.amountMinor])).toEqual([
      ['provider', 'available', -4_750_000],
      ['seller', 'pending', 4_275_000],
      ['platform', 'available', 225_000],
      ['shipping', 'available', 250_000],
    ]);
    expect(lines.reduce((a, l) => a + l.amountMinor, 0)).toBe(0);
    await send(h.app, providerEvent('charge.succeeded', paid.payment.providerRef, 4_750_000)); // the provider re-sends under a new event id
    expect(
      await WalletTransaction.countDocuments({ journalKey: `capture:${paid.payment.id}` }),
    ).toBe(4);
    const wallet = (await ok(call('get', farmer, '/wallet'))).body.wallet;
    expect(wallet).toMatchObject({ pendingMinor: 4_275_000, availableMinor: 0 });
    note(
      '13-15',
      'Payment, fee and proceeds',
      [
        'payment succeeded via the provider’s signed callback',
        'fee 5 % of 45,000 = 2,250 ฿ (shipping not commissionable), frozen with its calculation on the order',
        'journal: provider −47,500; seller pending +42,750; platform +2,250; carrier +2,500; sums to 0',
        'a repeated callback created no second journal',
        'seller wallet 42,750 ฿ pending',
      ],
      { paymentId: paid.payment.id },
    );
  });

  it('16. Track delivery: process → ship with tracking → carrier event → delivered; earnings released exactly once', async () => {
    await ok(call('post', farmer, `/orders/${S.order.id}/process`), 200);
    const shipped = await ok(
      call('post', farmer, `/orders/${S.order.id}/ship`, {
        carrier: 'Livestock Express',
        trackingNumber: 'LE-ACCEPT-01',
        expectedDays: { min: 2, max: 3 },
      }),
      200,
    );
    expect(shipped.body.order.status).toBe('SHIPPED');
    const shipmentId = shipped.body.order.shipments[0].id;
    await ok(
      call('post', farmer, `/orders/${S.order.id}/shipments/${shipmentId}/events`, {
        status: 'out_for_delivery',
      }),
      200,
    );
    const view = (await ok(call('get', buyer, `/orders/${S.order.id}`))).body.order;
    expect(view.shipments[0]).toMatchObject({
      trackingNumber: 'LE-ACCEPT-01',
      status: 'out_for_delivery',
    });
    expect(
      (await ok(call('post', buyer, `/orders/${S.order.id}/confirm-delivery`), 200)).body.order
        .status,
    ).toBe('DELIVERED');
    expect((await call('post', buyer, `/orders/${S.order.id}/confirm-delivery`)).status).toBe(409);
    expect((await ok(call('get', farmer, '/wallet'))).body.wallet).toMatchObject({
      pendingMinor: 0,
      availableMinor: 4_275_000,
    });
    note(
      '16',
      'Delivery tracking',
      [
        'PAID → PROCESSING → SHIPPED (tracking LE-ACCEPT-01) → out_for_delivery → DELIVERED',
        'second confirmation refused',
        'earnings moved from pending to available once (42,750 ฿)',
      ],
      { orderId: S.order.id },
    );
  });

  it('17. Refund when eligible: a paid order is cancelled, finance approves, the provider confirms, the ledger reverses', async () => {
    const { neg, listing } = await listedAndAccepted(S.farmId, 'BUF-002', 3_000_000);
    const order = (
      await ok(
        call('post', buyer, '/orders', { negotiationId: neg.id, fulfillment: 'pickup' }),
        201,
      )
    ).body.order;
    await payOrder(h, buyer, order);
    expect(
      (await call('post', buyer, `/orders/${S.order.id}/cancel`, { reason: 'changed my mind' }))
        .status,
    ).toBe(409); // delivered: not eligible
    expect(
      (await call('post', neighbour, `/orders/${order.id}/cancel`, { reason: 'not mine' })).status,
    ).toBe(404);
    expect(
      (
        await ok(
          call('post', buyer, `/orders/${order.id}/cancel`, { reason: 'Changed my mind' }),
          200,
        )
      ).body.order.status,
    ).toBe('REFUND_PENDING');
    const refund = (await Refund.findOne({ orderId: order.id }))!;
    expect(refund).toMatchObject({ status: 'requested', amountMinor: 3_000_000 });
    expect(
      (
        await call('post', buyer, `/admin/finance/refunds/${refund._id}/approve`, {
          confirmation: refund.refundNo,
        })
      ).status,
    ).toBe(403);
    await ok(
      call('post', finance, `/admin/finance/refunds/${refund._id}/approve`, {
        confirmation: refund.refundNo,
      }),
      200,
    );
    const stored = (await Refund.findById(refund._id))!;
    h.payments!.settleRefund(stored.providerRef!, 'succeeded');
    const ev = providerEvent('refund.succeeded', stored.providerRef!, 3_000_000);
    expect((await send(h.app, ev)).body.result).toBe('succeeded');
    expect((await send(h.app, ev)).body.result).toBe('duplicate');
    expect((await Order.findById(order.id))!.status).toBe('REFUNDED');
    expect((await Payment.findOne({ orderId: order.id }))!.status).toBe('refunded');
    expect(
      (await ok(call('get', farmer, `/marketplace/listings/${listing.id}`))).body.listing.status,
    ).toBe('ACTIVE'); // the animal is back on sale
    const lines = await WalletTransaction.find({ journalKey: `refund:${refund._id}` });
    expect(lines.reduce((a, l) => a + l.amountMinor, 0)).toBe(0);
    note(
      '17',
      'Refund',
      [
        'delivered order cannot be cancelled; a stranger cannot cancel',
        'cancel after payment → full refund requested',
        'buyer cannot approve; finance approval → one provider refund → callback completes it; duplicate callback harmless',
        'order REFUNDED, payment refunded, ledger reversed (sums to 0), animal back on sale',
      ],
      { refundId: String(refund._id) },
    );
  });

  it('19. Purchase a product through the same order infrastructure (cart → checkout → pay → deliver, same fee and ledger)', async () => {
    const product = (
      await ok(
        call('post', farmer, `/farms/${S.farmId}/products`, {
          ...PRODUCT,
          sku: sku(),
          priceMinor: 200_000,
          stock: 20,
        }),
        201,
      )
    ).body.product;
    await ok(call('post', farmer, `/farms/${S.farmId}/products/${product.id}/submit`), 200);
    expect((await call('get', buyer, `/shop/products/${product.id}`)).status).toBe(404);
    await ok(call('post', moderator, `/shop/moderation/products/${product.id}/approve`), 200);
    await ok(call('put', buyer, `/shop/cart/items/${product.id}`, { quantity: 3 }), 200);
    const group = (await ok(call('get', buyer, '/shop/cart'))).body.cart.groups[0];
    expect(group.itemsMinor).toBe(600_000);
    expect(
      (
        await call('post', buyer, '/shop/cart/checkout', {
          fulfillment: 'pickup',
          expected: [{ farmId: group.farmId, itemsMinor: 1, shippingMinor: 0 }],
        })
      ).status,
    ).toBe(409);
    const checkout = await ok(
      call('post', buyer, '/shop/cart/checkout', {
        fulfillment: 'pickup',
        expected: [{ farmId: group.farmId, itemsMinor: 600_000, shippingMinor: 0 }],
      }),
      201,
    );
    const order = checkout.body.orders[0];
    expect(order.kind).toBe('product');
    expect(order.totals).toMatchObject({
      itemsMinor: 600_000,
      platformFeeMinor: 30_000,
      sellerPayoutMinor: 570_000,
    });
    await payOrder(h, buyer, order);
    await ok(call('post', farmer, `/orders/${order.id}/process`), 200);
    await ok(call('post', buyer, `/orders/${order.id}/confirm-delivery`), 200);
    expect((await Order.findById(order.id))!.status).toBe('DELIVERED');
    expect(
      (await ok(call('get', buyer, `/shop/products/${product.id}`))).body.product.available,
    ).toBe(17);
    expect((await ok(call('get', buyer, '/shop/cart'))).body.cart.groups).toHaveLength(0);
    note(
      '19',
      'Product purchase',
      [
        'product approved by a moderator before sale',
        'cart total 6,000 ฿; a checkout on a stale price is refused (409)',
        'same order/payment/ledger path: fee 5 % = 300 ฿, payout 5,700 ฿',
        'stock 20 → 17, cart emptied',
      ],
      { orderId: order.id },
    );
  });

  it('20. Users cannot access another farm’s private records', async () => {
    const f = `/farms/${S.farmId}`;
    const paths = [
      f,
      `${f}/animals`,
      `${f}/animals/${S.animalId}`,
      `${f}/weights`,
      `${f}/health`,
      `${f}/feeding`,
      `${f}/expenses`,
      `${f}/dashboard`,
      `${f}/assessments/${S.assessmentId}`,
      `${f}/listings`,
      `${f}/members`,
    ];
    for (const path of paths)
      for (const [name, who] of [
        ['neighbour', neighbour],
        ['buyer', buyer],
      ] as const)
        expect((await call('get', who, path)).status, `${path} as ${name}`).toBe(404);
    expect(
      (
        await call('post', neighbour, `${f}/weights`, {
          animalId: S.animalId,
          weighedOn: daysAgo(1),
          weightKg: 1,
        })
      ).status,
    ).toBe(404);
    expect((await call('get', neighbour, `/orders/${S.order.id}`)).status).toBe(404);
    expect((await ok(call('get', neighbour, '/wallet'))).body.wallet.availableMinor).toBe(0);
    expect((await ok(call('get', farmer, `${f}/animals/${S.animalId}`))).status).toBe(200);
    note(
      '20',
      'Farm isolation',
      [
        '11 private farm routes × (another farm owner, an unrelated buyer) → 404',
        'cannot write to another farm or read another party’s order',
        'owner access unchanged',
      ],
      { farmId: S.farmId, otherFarmId: S.otherFarmId },
    );
  });

  it('18. Administrator audit history shows who did what, without secrets', async () => {
    const list = async (q: string) =>
      (await ok(call('get', admin, `/admin/audit-logs?${q}&pageSize=100`))).body;
    for (const action of [
      'auth.register',
      'registration.submitted',
      'farm.created',
      'animal.created',
    ])
      expect(
        ((await list(`action=${encodeURIComponent(action)}`)).items ?? []).length,
        action,
      ).toBeGreaterThan(0);
    const mine = (await list(`actorId=${farmer.id}`)).items as any[];
    expect(mine.length).toBeGreaterThan(8);
    const money = await ok(call('get', finance, '/admin/finance/audit-logs?limit=100'));
    expect((money.body.items as any[]).map((r) => r.action)).toEqual(
      expect.arrayContaining([
        'payment.created',
        'payment.succeeded',
        'refund.requested',
        'refund.approved',
        'refund.succeeded',
      ]),
    );
    expect((await call('get', farmer, '/admin/finance/audit-logs')).status).toBe(403);
    expect((await call('get', farmer, '/admin/audit-logs')).status).toBe(403);
    expect((await ok(call('get', finance, '/admin/finance/audit-logs/verify'))).status).toBe(200);
    const rows = [
      ...(await AuditLog.find().lean()),
      ...(await FinancialAuditLog.find().lean()),
    ].map((r: any) => ({ ...r, hash: undefined, prevHash: undefined }));
    expect(findSecrets(JSON.parse(JSON.stringify(rows)))).toEqual([]);
    expect(JSON.stringify(rows)).not.toContain(PASSWORD);
    note(
      '18',
      'Administrator audit history',
      [
        'registration, farm, animal and account events attributed to the actor',
        'financial trail has payment and refund events and verifies',
        'farmers cannot read either trail',
        'no password/token/key in any audit row',
      ],
      {},
    );
  });

  it('FINANCIAL RECONCILIATION: ledger balances, wallets equal their ledgers, commission equals the fees of the sales that stand, platform reconciliation is clean', async () => {
    expect(
      (
        await WalletTransaction.aggregate([{ $group: { _id: null, s: { $sum: '$amountMinor' } } }])
      )[0]?.s ?? 0,
    ).toBe(0);
    for (const w of await Wallet.find())
      for (const bucket of ['available', 'pending'] as const) {
        const sum =
          (
            await WalletTransaction.aggregate([
              { $match: { walletId: w._id, bucket } },
              { $group: { _id: null, s: { $sum: '$amountMinor' } } },
            ])
          )[0]?.s ?? 0;
        expect(
          bucket === 'available' ? w.availableMinor : w.pendingMinor,
          `${w.kind} ${bucket}`,
        ).toBe(sum);
      }
    const standing = await Order.find({
      status: { $in: ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'] },
    });
    const fees = standing.reduce((s, o) => s + o.platformFeeMinor, 0);
    expect(fees).toBe(255_000); // 2,250 ฿ (animal) + 300 ฿ (product); the refunded sale returned its fee
    const platform = (await Wallet.findOne({ kind: 'platform' }))!;
    expect(platform.availableMinor + platform.pendingMinor).toBe(fees);
    const seller = (await Wallet.findOne({ kind: 'seller', ownerId: farmer.id }))!;
    expect(seller.availableMinor + seller.pendingMinor).toBe(4_275_000 + 570_000);
    const rec = await ok(call('post', finance, '/admin/finance/reconcile', {}), 200);
    expect(rec.body.report.ledgerSumMinor).toBe(0);
    expect(
      rec.body.report.issues.filter((i: any) =>
        ['ledger_unbalanced', 'negative_balance', 'wallet_drift', 'missing_journal'].includes(
          i.kind,
        ),
      ),
    ).toEqual([]);
    note(
      'reconciliation',
      'Financial reconciliation',
      [
        'ledger sums to 0',
        'every wallet equals its ledger lines',
        'platform wallet 2,550 ฿ = fees of the two standing sales',
        'seller proceeds 42,750 + 5,700 ฿',
        'platform reconciliation reports no issues',
      ],
      {},
    );
  });
});
