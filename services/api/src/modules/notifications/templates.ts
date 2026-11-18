import type { NotificationType } from '@farmplus/shared-types';

export interface Rendered {
  title: string;
  body: string;
  link: string | null;
}

const baht = (minor: number) =>
  `฿${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Notification wording. Only facts the recipient may know (order number, status, amount of an offer in THEIR
 * negotiation, a moderator's reason addressed to them) — never a chat message or an offer note.
 */
export const TEMPLATES = {
  'order.placed': (p: { link?: string; orderNo: string }): Rendered => ({
    title: 'New order received',
    body: `Order ${p.orderNo} was placed and is waiting for payment.`,
    link: p.link ?? '/market/orders',
  }),
  'order.paid': (p: { link?: string; orderNo: string; side: 'buyer' | 'seller' }): Rendered => ({
    title: p.side === 'buyer' ? 'Payment received' : 'Order paid',
    body:
      p.side === 'buyer'
        ? `We received your payment for order ${p.orderNo}.`
        : `Order ${p.orderNo} is paid. You can start preparing it.`,
    link: p.link ?? '/market/orders',
  }),
  'order.processing': (p: { link?: string; orderNo: string }): Rendered => ({
    title: 'Order is being prepared',
    body: `The seller started preparing order ${p.orderNo}.`,
    link: p.link ?? '/market/orders',
  }),
  'order.shipped': (p: { link?: string; orderNo: string }): Rendered => ({
    title: 'Order shipped',
    body: `Order ${p.orderNo} is on its way.`,
    link: p.link ?? '/market/orders',
  }),
  'order.delivered': (p: {
    link?: string;
    orderNo: string;
    side: 'buyer' | 'seller';
  }): Rendered => ({
    title: 'Order completed',
    body:
      p.side === 'buyer'
        ? `Order ${p.orderNo} was marked as received.`
        : `Order ${p.orderNo} was received by the buyer.`,
    link: p.link ?? '/market/orders',
  }),
  'order.cancelled': (p: { link?: string; orderNo: string }): Rendered => ({
    title: 'Order cancelled',
    body: `Order ${p.orderNo} was cancelled.`,
    link: p.link ?? '/market/orders',
  }),
  'order.refund_pending': (p: { link?: string; orderNo: string }): Rendered => ({
    title: 'Refund started',
    body: `Order ${p.orderNo} was cancelled after payment; a refund is being processed.`,
    link: p.link ?? '/market/orders',
  }),
  'order.refunded': (p: { link?: string; orderNo: string }): Rendered => ({
    title: 'Refund completed',
    body: `The refund for order ${p.orderNo} was completed.`,
    link: p.link ?? '/market/orders',
  }),
  'order.payment_expired': (p: { link?: string; orderNo: string }): Rendered => ({
    title: 'Order expired',
    body: `Order ${p.orderNo} was cancelled because it was not paid in time.`,
    link: p.link ?? '/market/orders',
  }),
  'offer.received': (p: { link?: string; amountMinor: number; title: string }): Rendered => ({
    title: 'New offer',
    body: `An offer of ${baht(p.amountMinor)} was made on “${p.title}”.`,
    link: p.link ?? '/market/offers',
  }),
  'offer.countered': (p: { link?: string; amountMinor: number; title: string }): Rendered => ({
    title: 'Counter-offer',
    body: `A counter-offer of ${baht(p.amountMinor)} was made on “${p.title}”.`,
    link: p.link ?? '/market/offers',
  }),
  'offer.accepted': (p: { link?: string; title: string }): Rendered => ({
    title: 'Offer accepted',
    body: `The offer on “${p.title}” was accepted. The next step is the order.`,
    link: p.link ?? '/market/offers',
  }),
  'offer.rejected': (p: { link?: string; title: string }): Rendered => ({
    title: 'Offer declined',
    body: `The seller declined the offer on “${p.title}”.`,
    link: p.link ?? '/market/offers',
  }),
  'offer.withdrawn': (p: { link?: string; title: string }): Rendered => ({
    title: 'Offer withdrawn',
    body: `The buyer withdrew the offer on “${p.title}”.`,
    link: p.link ?? '/market/offers',
  }),
  'farm.member_added': (p: { farmName: string; role: string; farmId: string }): Rendered => ({
    title: 'You were added to a farm',
    body: `You are now ${p.role} of ${p.farmName}.`,
    link: `/farms/${p.farmId}`,
  }),
  'farm.member_removed': (p: { farmName: string }): Rendered => ({
    title: 'Farm access removed',
    body: `You no longer have access to ${p.farmName}.`,
    link: '/farms',
  }),
  'farm.member_role_changed': (p: {
    farmName: string;
    role: string;
    farmId: string;
  }): Rendered => ({
    title: 'Your farm role changed',
    body: `Your role on ${p.farmName} is now ${p.role}.`,
    link: `/farms/${p.farmId}`,
  }),
  'farm.sale_completed': (p: { title: string; farmId: string }): Rendered => ({
    title: 'Sale completed',
    body: `“${p.title}” was delivered to the buyer and the sale is complete.`,
    link: `/farms/${p.farmId}`,
  }),
  'moderation.listing_approved': (p: { title: string }): Rendered => ({
    title: 'Listing approved',
    body: `“${p.title}” is now live.`,
    link: '/market/sell',
  }),
  'moderation.listing_rejected': (p: { title: string; reason: string }): Rendered => ({
    title: 'Listing not approved',
    body: `“${p.title}” was not approved: ${p.reason}`,
    link: '/market/sell',
  }),
  'moderation.listing_suspended': (p: { title: string; reason: string }): Rendered => ({
    title: 'Listing paused by a moderator',
    body: `“${p.title}” was paused: ${p.reason}`,
    link: '/market/sell',
  }),
  'moderation.listing_restored': (p: { title: string }): Rendered => ({
    title: 'Listing restored',
    body: `“${p.title}” is live again.`,
    link: '/market/sell',
  }),
  'moderation.product_approved': (p: { title: string }): Rendered => ({
    title: 'Product approved',
    body: `“${p.title}” is now on sale.`,
    link: '/shop/sell',
  }),
  'moderation.product_rejected': (p: { title: string; reason: string }): Rendered => ({
    title: 'Product not approved',
    body: `“${p.title}” was not approved: ${p.reason}`,
    link: '/shop/sell',
  }),
  'moderation.product_suspended': (p: { title: string; reason: string }): Rendered => ({
    title: 'Product paused by a moderator',
    body: `“${p.title}” was paused: ${p.reason}`,
    link: '/shop/sell',
  }),
  'moderation.product_restored': (p: { title: string }): Rendered => ({
    title: 'Product restored',
    body: `“${p.title}” is on sale again.`,
    link: '/shop/sell',
  }),
  'moderation.content_hidden': (p: { kind: string; reason: string }): Rendered => ({
    title: 'Your content was hidden',
    body: `A moderator hid your ${p.kind}: ${p.reason}`,
    link: null,
  }),
  'moderation.content_removed': (p: { kind: string; reason: string }): Rendered => ({
    title: 'Your content was removed',
    body: `A moderator removed your ${p.kind}: ${p.reason}`,
    link: null,
  }),
  'moderation.content_restored': (p: { kind: string }): Rendered => ({
    title: 'Your content was restored',
    body: `Your ${p.kind} is visible again.`,
    link: null,
  }),
  'moderation.registration_decided': (p: {
    type: string;
    outcome: string;
    reason: string;
  }): Rendered => ({
    title: `Your ${p.type.replace('_', ' ')} registration: ${p.outcome.toLowerCase()}`,
    body: p.reason,
    link: null,
  }),
  'moderation.message_report_resolved': (p: { outcome: string }): Rendered => ({
    title: 'Your message report was reviewed',
    body: `A moderator reviewed your report (${p.outcome}). Thank you for helping keep FARM+ safe.`,
    link: null,
  }),
  'moderation.message_warning': (): Rendered => ({
    title: 'Warning about your messages',
    body: 'A moderator reviewed a report about your messages and asks you to follow the community guidelines. Further reports may restrict messaging.',
    link: null,
  }),
  'message.new': (p: { count?: number; who: string; link?: string }): Rendered => ({
    title: `New message from ${p.who}`,
    body: (p.count ?? 1) > 1 ? `${p.count} new messages.` : 'You have a new message.',
    link: p.link ?? '/messages',
  }),
} satisfies Record<NotificationType, (p: never) => Rendered>;

export type TemplateParams<T extends NotificationType> = Parameters<(typeof TEMPLATES)[T]>[0];
export const render = <T extends NotificationType>(type: T, params: TemplateParams<T>): Rendered =>
  (TEMPLATES[type] as (p: TemplateParams<T>) => Rendered)(params);
