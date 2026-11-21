import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Animal,
  AuditLog,
  BreedingRecord,
  FarmInvitation,
  FarmMember,
  Conversation,
  Listing,
  Message,
  Notification,
  Order,
  Payment,
  Refund,
  Product,
  Wallet,
  WalletTransaction,
  Withdrawal,
} from '../../src/models';
import { byProviderRef } from '../../src/modules/finance/provider-ref';
import { startHarness, type TestHarness } from '../helpers';

let h: TestHarness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.stop();
});

const id = () => new Types.ObjectId();
const stages = (plan: unknown): string[] => {
  const out: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- explain output is an arbitrary tree
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (typeof n.stage === 'string') out.push(n.stage);
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(walk);
      else walk(v);
    }
  };
  walk(plan);
  return out;
};

/** The hot queries of the busiest screens. A COLLSCAN here means a full collection read per request once the data grows. */
const HOT: [string, () => Promise<unknown>][] = [
  [
    'notifications: my list',
    () => Notification.find({ userId: id() }).sort({ _id: -1 }).limit(21).explain('queryPlanner'),
  ],
  [
    'notifications: my unread count',
    () =>
      Notification.countDocuments({ userId: id(), readAt: null }).explain(
        'queryPlanner' as never,
      ) as never,
  ],
  [
    'chat: messages of a conversation',
    () =>
      Message.find({ conversationId: id() }).sort({ seq: -1 }).limit(31).explain('queryPlanner'),
  ],
  [
    'chat: my unread messages (buyer)',
    () => Message.find({ buyerId: id(), side: 'seller', readAt: null }).explain('queryPlanner'),
  ],
  [
    'chat: my conversations (buyer)',
    () =>
      Conversation.find({ buyerId: id() })
        .sort({ lastMessageAt: -1, _id: -1 })
        .limit(21)
        .explain('queryPlanner'),
  ],
  [
    'chat: farm conversations',
    () =>
      Conversation.find({ farmId: id() })
        .sort({ lastMessageAt: -1, _id: -1 })
        .limit(21)
        .explain('queryPlanner'),
  ],
  [
    'orders: my orders',
    () =>
      Order.find({ buyerId: id() })
        .sort({ createdAt: -1, _id: -1 })
        .limit(21)
        .explain('queryPlanner'),
  ],
  [
    'orders: a farm’s orders by status',
    () =>
      Order.find({ farmId: id(), status: 'PAID' })
        .sort({ createdAt: -1, _id: -1 })
        .limit(21)
        .explain('queryPlanner'),
  ],
  [
    'orders: unpaid past deadline (cleanup job)',
    () =>
      Order.find({ status: 'PENDING_PAYMENT', paymentDueAt: { $lt: new Date() } }).explain(
        'queryPlanner',
      ),
  ],
  [
    'marketplace: browse active listings',
    () =>
      Listing.find({ status: 'ACTIVE' })
        .sort({ activatedAt: -1, _id: -1 })
        .limit(21)
        .explain('queryPlanner'),
  ],
  [
    'marketplace: a farm’s listings',
    () =>
      Listing.find({ farmId: id(), status: 'ACTIVE' })
        .sort({ createdAt: -1, _id: -1 })
        .limit(21)
        .explain('queryPlanner'),
  ],
  [
    'marketplace: expiring listings (cleanup job)',
    () =>
      Listing.find({ status: 'ACTIVE', expiresAt: { $lt: new Date() } }).explain('queryPlanner'),
  ],
  [
    'shop: a farm’s products',
    () =>
      Product.find({ farmId: id(), status: 'ACTIVE' })
        .sort({ createdAt: -1 })
        .limit(21)
        .explain('queryPlanner'),
  ],
  [
    'animals: a farm’s animals',
    () =>
      Animal.find({ farmId: id(), archivedAt: null })
        .sort({ createdAt: -1, _id: -1 })
        .limit(21)
        .explain('queryPlanner'),
  ],
  [
    'animals: one by code within a farm',
    () => Animal.find({ farmId: id(), animalCode: 'X-1' }).explain('queryPlanner'),
  ],
  [
    'finance: wallet ledger lines',
    () =>
      WalletTransaction.find({ walletId: id() })
        .sort({ createdAt: -1, _id: -1 })
        .limit(21)
        .explain('queryPlanner'),
  ],
  [
    'finance: my wallet',
    () => Wallet.find({ kind: 'seller', ownerId: id() }).explain('queryPlanner'),
  ],
  [
    'finance: a payment by provider reference (webhook)',
    () => Payment.find(byProviderRef('mock', 'chg_x')).explain('queryPlanner'),
  ],
  [
    'finance: a refund by provider reference (webhook)',
    () => Refund.find(byProviderRef('mock', 'rfd_x')).explain('queryPlanner'),
  ],
  [
    'finance: a withdrawal by provider reference (webhook)',
    () => Withdrawal.find(byProviderRef('mock', 'po_x')).explain('queryPlanner'),
  ],
  [
    'finance: withdrawals awaiting a decision',
    () =>
      Withdrawal.find({ status: 'requested' })
        .sort({ requestedAt: 1 })
        .limit(21)
        .explain('queryPlanner'),
  ],
  [
    'audit log: newest first',
    () => AuditLog.find({}).sort({ createdAt: -1 }).limit(21).explain('queryPlanner'),
  ],
  // Farm staff, breeding and pedigree (2026-11-21)
  [
    'farm invitations: a farm’s by status, newest first',
    () =>
      FarmInvitation.find({ farmId: id(), status: 'PENDING' })
        .sort({ createdAt: -1 })
        .limit(200)
        .explain('queryPlanner'),
  ],
  [
    'farm invitations: mine, newest first',
    () =>
      FarmInvitation.find({ userId: id() })
        .sort({ createdAt: -1 })
        .limit(200)
        .explain('queryPlanner'),
  ],
  [
    'farm invitations: revoke on membership end',
    () =>
      FarmInvitation.find({ farmId: id(), userId: id(), status: 'APPROVED' }).explain(
        'queryPlanner',
      ),
  ],
  [
    'farm members: owners of a farm (notifications)',
    () => FarmMember.find({ farmId: id(), role: 'owner' }).explain('queryPlanner'),
  ],
  [
    'animals: by breed group (breed keys)',
    () =>
      Animal.find({ farmId: id(), archivedAt: null, breed: { $in: ['a', 'b'] } })
        .limit(20)
        .explain('queryPlanner'),
  ],
  [
    'animals: offspring of an animal (lineage)',
    () =>
      Animal.find({ farmId: id(), $or: [{ sireId: id() }, { damId: id() }] }).explain(
        'queryPlanner',
      ),
  ],
  [
    'breeding: an animal’s history (dam or sire)',
    () =>
      BreedingRecord.find({ farmId: id(), voided: false, $or: [{ damId: id() }, { sireId: id() }] })
        .sort({ breedingDate: -1, _id: -1 })
        .limit(20)
        .explain('queryPlanner'),
  ],
];

describe('hot queries use an index (no full collection scans)', () => {
  it.each(HOT)('%s', async (_name, run) => {
    const plan = await run();
    expect(stages(plan), JSON.stringify(plan).slice(0, 400)).not.toContain('COLLSCAN');
  });
});

describe('webhook handlers look records up by provider reference the indexed way', () => {
  it('no service queries (provider, providerRef) with a bare equality that the partial unique index cannot serve', () => {
    const dir = join(process.cwd(), 'src/modules/finance');
    const offenders: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts')))
      readFileSync(join(dir, f), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/providerRef:\s*(event\.ref|c\.ref|ref)\b/.test(line))
            offenders.push(`${f}:${i + 1}: ${line.trim()}`);
        });
    expect(offenders).toEqual([]);
  });
});
