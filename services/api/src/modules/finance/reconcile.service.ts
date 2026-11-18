import type { ReconciliationIssue, ReconciliationReport } from '@farmplus/shared-types';
import { byProviderRef } from './provider-ref';
import type { Actor } from '../../context';
import { Order, Payment, Refund, Wallet, WalletTransaction, Withdrawal } from '../../models';
import { userActor, recordFinancial, verifyAuditChain, PROVIDER } from './audit';
import {
  journalExists,
  postCapture,
  postRelease,
  postWithdrawalHold,
  sellerWallet,
} from './ledger';
import {
  applyChargeEvent,
  expireStalePayments,
  finalizePayment,
  type FinanceDeps,
} from './payments.service';
import { completeRefund, failRefund } from './refunds.service';
import { completePayout, failPayout } from './withdrawals.service';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/**
 * Compares the books with themselves and with the provider.
 *  - Ledger: every journal balances; every wallet balance equals the sum of its ledger lines; no seller balance < 0.
 *  - Flow: every payment/refund/withdrawal/order state has the journals it should (a crash between two steps leaves a gap).
 *  - Provider: our payment, refund and payout statuses and amounts match the provider's records; unknown provider
 *    charges are reported.
 * Read-only unless `repair`, which only ever applies facts that are already certain (ledger truth, provider truth) by
 * running the same idempotent code the webhooks use. Amount disagreements are reported, never "fixed".
 */
export async function reconcile(
  actor: Actor,
  opts: { repair: boolean },
  deps: FinanceDeps,
): Promise<ReconciliationReport> {
  const issues: ReconciliationIssue[] = [];
  let repaired = 0;
  const flag = (issue: ReconciliationIssue) => issues.push(issue);
  const fixed = (issue: ReconciliationIssue) => {
    issues.push({ ...issue, repaired: true });
    repaired++;
  };
  const who = userActor(actor.userId);

  // ---- 1. flow completeness (done first so repairs show up in the balance checks below)
  const succeededUnfinalized = await Payment.find({
    status: { $in: ['succeeded', 'refunded'] },
    disposition: null,
  });
  for (const p of succeededUnfinalized) {
    const issue: ReconciliationIssue = {
      kind: 'missing_journal',
      ref: `payment:${p._id}`,
      detail: 'Payment succeeded but was never applied or parked',
    };
    if (opts.repair) {
      await finalizePayment(p._id, who);
      fixed(issue);
    } else flag(issue);
  }
  const applied = await Payment.find({ disposition: 'applied' });
  let paymentsChecked = 0;
  for (const p of applied) {
    paymentsChecked++;
    if (await journalExists(`capture:${p._id}`)) continue;
    const issue: ReconciliationIssue = {
      kind: 'missing_journal',
      ref: `capture:${p._id}`,
      detail: 'Applied payment has no capture journal',
    };
    const order = await Order.findById(p.orderId);
    if (opts.repair && order) {
      await postCapture(order, p, who);
      fixed(issue);
    } else flag(issue);
  }
  const delivered = await Order.find({ status: 'DELIVERED', paymentRef: { $ne: null } });
  for (const o of delivered) {
    if (o.sellerPayoutMinor <= 0 || (await journalExists(`release:${o._id}`))) continue;
    const issue: ReconciliationIssue = {
      kind: 'missing_journal',
      ref: `release:${o._id}`,
      detail: `Delivered order ${o.orderNo} never released the seller's earnings`,
    };
    if (opts.repair) {
      await postRelease(o, who);
      fixed(issue);
    } else flag(issue);
  }
  const doneRefunds = await Refund.find({ status: 'succeeded' });
  for (const r of doneRefunds) {
    const order = r.orderId ? await Order.findById(r.orderId) : null;
    const journal = await journalExists(`refund:${r._id}`);
    const orderOpen = order?.status === 'REFUND_PENDING';
    if (journal && !orderOpen) continue;
    const issue: ReconciliationIssue = {
      kind: 'missing_journal',
      ref: `refund:${r._id}`,
      detail: `Refund ${r.refundNo} is complete but its ledger reversal or order update is missing`,
    };
    if (opts.repair) {
      await completeRefund(r._id, who);
      fixed(issue);
    } else flag(issue);
  }
  const holds = await Withdrawal.find({
    status: { $in: ['requested', 'approved', 'processing', 'paid'] },
  });
  for (const w of holds) {
    if (await journalExists(`wd_hold:${w._id}`)) continue;
    const issue: ReconciliationIssue = {
      kind: 'missing_journal',
      ref: `wd_hold:${w._id}`,
      detail: `Withdrawal ${w.withdrawalNo} has no hold in the ledger`,
    };
    if (opts.repair) {
      await postWithdrawalHold(w, await sellerWallet(w.sellerId), who, false);
      fixed(issue);
    } else flag(issue);
  }

  // ---- 2. ledger integrity
  const [total] = await WalletTransaction.aggregate<{ sum: number }>([
    { $group: { _id: null, sum: { $sum: '$amountMinor' } } },
  ]);
  const ledgerSumMinor = total?.sum ?? 0;
  if (ledgerSumMinor !== 0)
    flag({
      kind: 'ledger_unbalanced',
      ref: 'ledger',
      detail: `All ledger lines sum to ${ledgerSumMinor}, not 0`,
    });
  const journals = await WalletTransaction.aggregate<{ _id: string; sum: number }>([
    { $group: { _id: '$journalKey', sum: { $sum: '$amountMinor' } } },
    { $match: { sum: { $ne: 0 } } },
  ]);
  for (const j of journals)
    flag({ kind: 'ledger_unbalanced', ref: j._id, detail: `Journal sums to ${j.sum}` });

  const sums = await WalletTransaction.aggregate<{
    _id: { w: unknown; b: 'pending' | 'available' };
    sum: number;
  }>([{ $group: { _id: { w: '$walletId', b: '$bucket' }, sum: { $sum: '$amountMinor' } } }]);
  const derived = new Map<string, { pending: number; available: number }>();
  for (const s of sums) {
    const key = String(s._id.w);
    const cur = derived.get(key) ?? { pending: 0, available: 0 };
    cur[s._id.b] = s.sum;
    derived.set(key, cur);
  }
  const wallets = await Wallet.find();
  for (const w of wallets) {
    const d = derived.get(String(w._id)) ?? { pending: 0, available: 0 };
    if (d.pending !== w.pendingMinor || d.available !== w.availableMinor) {
      const issue: ReconciliationIssue = {
        kind: 'wallet_drift',
        ref: `wallet:${w._id}`,
        detail: `Balance shows ${w.pendingMinor}/${w.availableMinor} (pending/available) but the ledger says ${d.pending}/${d.available}`,
      };
      if (opts.repair) {
        // Compare-and-set on the old projection: a posting that lands mid-repair makes this a no-op instead of a wrong write.
        const res = await Wallet.updateOne(
          { _id: w._id, pendingMinor: w.pendingMinor, availableMinor: w.availableMinor },
          { $set: { pendingMinor: d.pending, availableMinor: d.available } },
        );
        if (res.modifiedCount === 1) {
          await recordFinancial({
            actor: who,
            action: 'wallet.projection_repaired',
            targetType: 'wallet',
            targetId: w._id,
            data: { from: [w.pendingMinor, w.availableMinor], to: [d.pending, d.available] },
          });
          fixed(issue);
        } else flag(issue);
      } else flag(issue);
    }
    if (w.kind === 'seller' && (d.pending < 0 || d.available < 0))
      flag({
        kind: 'negative_balance',
        ref: `wallet:${w._id}`,
        detail: `Seller balance is negative in the ledger (${d.pending}/${d.available})`,
      });
  }

  // ---- 3. provider records
  const provider = deps.provider;
  let refundsChecked = 0;
  let withdrawalsChecked = 0;
  if (provider) {
    const open = await Payment.find({
      status: { $in: ['pending', 'cancelled', 'expired', 'succeeded'] },
      providerRef: { $ne: null },
      createdAt: { $gte: new Date(Date.now() - 30 * DAY) },
    });
    const known = new Set<string>();
    for (const p of open) {
      paymentsChecked++;
      known.add(p.providerRef!);
      const remote = await provider.getCharge(p.providerRef!);
      if (!remote) {
        flag({
          kind: 'provider_status_mismatch',
          ref: `payment:${p._id}`,
          detail: 'The provider has no record of this charge',
        });
        continue;
      }
      if (remote.status === 'succeeded' && remote.amountMinor !== p.amountMinor) {
        flag({
          kind: 'provider_amount_mismatch',
          ref: `payment:${p._id}`,
          detail: `Provider captured ${remote.amountMinor}, we asked for ${p.amountMinor}`,
        });
        continue;
      }
      if (p.status === 'succeeded' && remote.status !== 'succeeded')
        flag({
          kind: 'provider_status_mismatch',
          ref: `payment:${p._id}`,
          detail: `We recorded success but the provider says ${remote.status}`,
        });
      else if (p.status !== 'succeeded' && remote.status === 'succeeded') {
        const issue: ReconciliationIssue = {
          kind: 'provider_status_mismatch',
          ref: `payment:${p._id}`,
          detail: `The provider captured this charge but we have it as ${p.status} (callback lost?)`,
        };
        if (opts.repair) {
          await applyChargeEvent(
            {
              id: `reconcile:${p._id}`,
              type: 'charge.succeeded',
              ref: remote.ref,
              amountMinor: remote.amountMinor,
              currency: remote.currency,
            },
            provider.name,
          );
          fixed(issue);
        } else flag(issue);
      } else if (p.status === 'pending' && remote.status === 'failed') {
        const issue: ReconciliationIssue = {
          kind: 'provider_status_mismatch',
          ref: `payment:${p._id}`,
          detail: 'The provider reports this charge failed but we still show it pending',
        };
        if (opts.repair) {
          await applyChargeEvent(
            {
              id: `reconcile:${p._id}`,
              type: 'charge.failed',
              ref: remote.ref,
              amountMinor: remote.amountMinor,
              currency: remote.currency,
              failureCode: remote.failureCode,
            },
            provider.name,
          );
          fixed(issue);
        } else flag(issue);
      }
    }
    for (const c of await provider.listCharges(new Date(Date.now() - 30 * DAY)))
      if (!known.has(c.ref) && !(await Payment.exists(byProviderRef(provider.name, c.ref))))
        flag({
          kind: 'provider_unknown_charge',
          ref: `charge:${c.ref}`,
          detail: `The provider has a ${c.status} charge of ${c.amountMinor} (${c.reference}) that we have no payment for`,
        });

    for (const r of await Refund.find({ status: 'processing', providerRef: { $ne: null } })) {
      refundsChecked++;
      const remote = await provider.getRefund(r.providerRef!);
      if (!remote || remote.status === 'pending') continue;
      if (remote.amountMinor !== r.amountMinor) {
        flag({
          kind: 'provider_amount_mismatch',
          ref: `refund:${r._id}`,
          detail: `Provider refunded ${remote.amountMinor}, expected ${r.amountMinor}`,
        });
        continue;
      }
      const issue: ReconciliationIssue = {
        kind: 'provider_status_mismatch',
        ref: `refund:${r._id}`,
        detail: `The provider says this refund ${remote.status}, we still show it processing`,
      };
      if (opts.repair) {
        if (remote.status === 'succeeded') await completeRefund(r._id, PROVIDER);
        else await failRefund(r._id, remote.failureCode ?? 'provider_failed');
        fixed(issue);
      } else flag(issue);
    }
    for (const w of await Withdrawal.find({ status: 'processing', providerRef: { $ne: null } })) {
      withdrawalsChecked++;
      const remote = await provider.getPayout(w.providerRef!);
      if (!remote || remote.status === 'pending') continue;
      if (remote.amountMinor !== w.amountMinor) {
        flag({
          kind: 'provider_amount_mismatch',
          ref: `withdrawal:${w._id}`,
          detail: `Provider paid ${remote.amountMinor}, expected ${w.amountMinor}`,
        });
        continue;
      }
      const issue: ReconciliationIssue = {
        kind: 'provider_status_mismatch',
        ref: `withdrawal:${w._id}`,
        detail: `The provider says this payout ${remote.status}, we still show it processing`,
      };
      if (opts.repair) {
        if (remote.status === 'succeeded') await completePayout(w._id, PROVIDER);
        else await failPayout(w._id, remote.failureCode ?? 'provider_failed');
        fixed(issue);
      } else flag(issue);
    }
  }

  // ---- 4. stale attempts
  const stale = await Payment.countDocuments({
    status: 'pending',
    expiresAt: { $lte: new Date() },
  });
  if (stale > 0) {
    const issue: ReconciliationIssue = {
      kind: 'stale_pending',
      ref: 'payments',
      detail: `${stale} payment attempt(s) are past their window`,
    };
    if (opts.repair) {
      await expireStalePayments(provider);
      fixed(issue);
    } else flag(issue);
  }

  // ---- 5. audit chain
  const chain = await verifyAuditChain();
  if (!chain.ok)
    flag({
      kind: 'audit_chain_broken',
      ref: `seq:${chain.brokenAtSeq}`,
      detail: chain.reason ?? 'The financial audit log was altered',
    });

  const report: ReconciliationReport = {
    ranAt: new Date().toISOString(),
    ledgerSumMinor,
    walletsChecked: wallets.length,
    paymentsChecked,
    refundsChecked,
    withdrawalsChecked,
    providerChecked: Boolean(provider),
    issues,
    repaired,
    ok: issues.every((i) => i.repaired),
  };
  await recordFinancial({
    actor: who,
    action: 'reconcile.run',
    targetType: 'reconciliation',
    targetId: report.ranAt,
    data: { repair: opts.repair, issues: issues.length, repaired, ok: report.ok },
  });
  return report;
}
