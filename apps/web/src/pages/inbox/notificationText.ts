import type { NotificationDTO, NotificationType } from '@farmplus/shared-types';
import type { Locale } from '@farmplus/i18n';
import type { Translate } from '../../i18n';

type InboxT = Translate<'inbox'>;
type Key = Parameters<InboxT>[0];

/**
 * The API renders notification wording in English (services/api/src/modules/notifications/templates.ts) and only
 * sends the result plus its `type`. For Thai, each known template is matched here, its facts (order number, title,
 * amount, reason…) are taken out, and the Thai wording is filled with them. Free text (a moderator's reason, a title)
 * is kept as written. Anything that does not match keeps a Thai title (the category) and the text as sent.
 */
interface Variant {
  re: RegExp;
  key: Key;
  names: string[];
}
const v = (re: RegExp, key: Key, ...names: string[]): Variant => ({ re, key, names });
const q = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A template with `{name}` slots as a whole-text pattern. */
const pattern = (template: string): RegExp =>
  new RegExp(`^${q(template).replace(/\\\{(\w+)\\\}/g, '(.+?)')}$`, 's');
const fixed = (english: string, key: Key) => v(pattern(english), key);

interface Spec {
  title: Variant[];
  body: Variant[];
}
const order = (title: string, titleKey: Key, body: string, bodyKey: Key): Spec => ({
  title: [fixed(title, titleKey)],
  body: [v(pattern(body), bodyKey, 'orderNo')],
});
const titled = (
  title: string,
  titleKey: Key,
  body: string,
  bodyKey: Key,
  ...names: string[]
): Spec => ({ title: [fixed(title, titleKey)], body: [v(pattern(body), bodyKey, ...names)] });

const SPECS: Record<NotificationType, Spec> = {
  'order.placed': order(
    'New order received',
    'n.order.placed.title',
    'Order {orderNo} was placed and is waiting for payment.',
    'n.order.placed.body',
  ),
  'order.paid': {
    title: [
      fixed('Payment received', 'n.order.paid.buyer.title'),
      fixed('Order paid', 'n.order.paid.seller.title'),
    ],
    body: [
      v(pattern('We received your payment for order {o}.'), 'n.order.paid.buyer.body', 'orderNo'),
      v(
        pattern('Order {o} is paid. You can start preparing it.'),
        'n.order.paid.seller.body',
        'orderNo',
      ),
    ],
  },
  'order.processing': order(
    'Order is being prepared',
    'n.order.processing.title',
    'The seller started preparing order {orderNo}.',
    'n.order.processing.body',
  ),
  'order.shipped': order(
    'Order shipped',
    'n.order.shipped.title',
    'Order {orderNo} is on its way.',
    'n.order.shipped.body',
  ),
  'order.delivered': {
    title: [fixed('Order completed', 'n.order.delivered.title')],
    body: [
      v(pattern('Order {o} was marked as received.'), 'n.order.delivered.buyer.body', 'orderNo'),
      v(
        pattern('Order {o} was received by the buyer.'),
        'n.order.delivered.seller.body',
        'orderNo',
      ),
    ],
  },
  'order.cancelled': order(
    'Order cancelled',
    'n.order.cancelled.title',
    'Order {orderNo} was cancelled.',
    'n.order.cancelled.body',
  ),
  'order.refund_pending': order(
    'Refund started',
    'n.order.refund_pending.title',
    'Order {orderNo} was cancelled after payment; a refund is being processed.',
    'n.order.refund_pending.body',
  ),
  'order.refunded': order(
    'Refund completed',
    'n.order.refunded.title',
    'The refund for order {orderNo} was completed.',
    'n.order.refunded.body',
  ),
  'order.payment_expired': order(
    'Order expired',
    'n.order.payment_expired.title',
    'Order {orderNo} was cancelled because it was not paid in time.',
    'n.order.payment_expired.body',
  ),
  'offer.received': titled(
    'New offer',
    'n.offer.received.title',
    'An offer of {amount} was made on “{title}”.',
    'n.offer.received.body',
    'amount',
    'title',
  ),
  'offer.countered': titled(
    'Counter-offer',
    'n.offer.countered.title',
    'A counter-offer of {amount} was made on “{title}”.',
    'n.offer.countered.body',
    'amount',
    'title',
  ),
  'offer.accepted': titled(
    'Offer accepted',
    'n.offer.accepted.title',
    'The offer on “{title}” was accepted. The next step is the order.',
    'n.offer.accepted.body',
    'title',
  ),
  'offer.rejected': titled(
    'Offer declined',
    'n.offer.rejected.title',
    'The seller declined the offer on “{title}”.',
    'n.offer.rejected.body',
    'title',
  ),
  'offer.withdrawn': titled(
    'Offer withdrawn',
    'n.offer.withdrawn.title',
    'The buyer withdrew the offer on “{title}”.',
    'n.offer.withdrawn.body',
    'title',
  ),
  'farm.member_added': titled(
    'You were added to a farm',
    'n.farm.member_added.title',
    'You are now {role} of {farm}.',
    'n.farm.member_added.body',
    'role',
    'farm',
  ),
  'farm.member_removed': titled(
    'Farm access removed',
    'n.farm.member_removed.title',
    'You no longer have access to {farm}.',
    'n.farm.member_removed.body',
    'farm',
  ),
  'farm.member_role_changed': titled(
    'Your farm role changed',
    'n.farm.member_role_changed.title',
    'Your role on {farm} is now {role}.',
    'n.farm.member_role_changed.body',
    'farm',
    'role',
  ),
  'farm.invitation_received': titled(
    'Farm invitation',
    'n.farm.invitation_received.title',
    'You were invited to help run {farm} as {role}.',
    'n.farm.invitation_received.body',
    'farm',
    'role',
  ),
  'farm.invitation_accepted': titled(
    'Invitation accepted',
    'n.farm.invitation_accepted.title',
    '{name} accepted your invitation to {farm}.',
    'n.farm.invitation_accepted.body',
    'name',
    'farm',
  ),
  'farm.invitation_declined': titled(
    'Invitation declined',
    'n.farm.invitation_declined.title',
    '{name} declined your invitation to {farm}.',
    'n.farm.invitation_declined.body',
    'name',
    'farm',
  ),
  'farm.join_requested': titled(
    'Request to join your farm',
    'n.farm.join_requested.title',
    '{name} asked to join {farm}.',
    'n.farm.join_requested.body',
    'name',
    'farm',
  ),
  'farm.join_rejected': titled(
    'Join request declined',
    'n.farm.join_rejected.title',
    'Your request to join {farm} was declined.',
    'n.farm.join_rejected.body',
    'farm',
  ),
  'farm.sale_completed': titled(
    'Sale completed',
    'n.farm.sale_completed.title',
    '“{title}” was delivered to the buyer and the sale is complete.',
    'n.farm.sale_completed.body',
    'title',
  ),
  'moderation.listing_approved': titled(
    'Listing approved',
    'n.moderation.listing_approved.title',
    '“{title}” is now live.',
    'n.moderation.listing_approved.body',
    'title',
  ),
  'moderation.listing_rejected': titled(
    'Listing not approved',
    'n.moderation.listing_rejected.title',
    '“{title}” was not approved: {reason}',
    'n.moderation.listing_rejected.body',
    'title',
    'reason',
  ),
  'moderation.listing_suspended': titled(
    'Listing paused by a moderator',
    'n.moderation.listing_suspended.title',
    '“{title}” was paused: {reason}',
    'n.moderation.listing_suspended.body',
    'title',
    'reason',
  ),
  'moderation.listing_restored': titled(
    'Listing restored',
    'n.moderation.listing_restored.title',
    '“{title}” is live again.',
    'n.moderation.listing_restored.body',
    'title',
  ),
  'moderation.product_approved': titled(
    'Product approved',
    'n.moderation.product_approved.title',
    '“{title}” is now on sale.',
    'n.moderation.product_approved.body',
    'title',
  ),
  'moderation.product_rejected': titled(
    'Product not approved',
    'n.moderation.product_rejected.title',
    '“{title}” was not approved: {reason}',
    'n.moderation.product_rejected.body',
    'title',
    'reason',
  ),
  'moderation.product_suspended': titled(
    'Product paused by a moderator',
    'n.moderation.product_suspended.title',
    '“{title}” was paused: {reason}',
    'n.moderation.product_suspended.body',
    'title',
    'reason',
  ),
  'moderation.product_restored': titled(
    'Product restored',
    'n.moderation.product_restored.title',
    '“{title}” is on sale again.',
    'n.moderation.product_restored.body',
    'title',
  ),
  'moderation.content_hidden': titled(
    'Your content was hidden',
    'n.moderation.content_hidden.title',
    'A moderator hid your {kind}: {reason}',
    'n.moderation.content_hidden.body',
    'kind',
    'reason',
  ),
  'moderation.content_removed': titled(
    'Your content was removed',
    'n.moderation.content_removed.title',
    'A moderator removed your {kind}: {reason}',
    'n.moderation.content_removed.body',
    'kind',
    'reason',
  ),
  'moderation.content_restored': titled(
    'Your content was restored',
    'n.moderation.content_restored.title',
    'Your {kind} is visible again.',
    'n.moderation.content_restored.body',
    'kind',
  ),
  'moderation.registration_decided': {
    title: [
      v(
        pattern('Your {type} registration: {outcome}'),
        'n.moderation.registration_decided.title',
        'type',
        'outcome',
      ),
    ],
    body: [], // the moderator's reason, shown as written
  },
  'moderation.message_report_resolved': titled(
    'Your message report was reviewed',
    'n.moderation.message_report_resolved.title',
    'A moderator reviewed your report ({outcome}). Thank you for helping keep FARM+ safe.',
    'n.moderation.message_report_resolved.body',
    'outcome',
  ),
  'moderation.message_warning': {
    title: [fixed('Warning about your messages', 'n.moderation.message_warning.title')],
    body: [
      fixed(
        'A moderator reviewed a report about your messages and asks you to follow the community guidelines. Further reports may restrict messaging.',
        'n.moderation.message_warning.body',
      ),
    ],
  },
  'message.new': {
    title: [v(pattern('New message from {who}'), 'n.message.new.title', 'who')],
    body: [
      fixed('You have a new message.', 'n.message.new.body'),
      v(/^(\d+) new messages\.$/, 'n.message.new.bodyMany', 'count'),
    ],
  },
};

/** Words the API puts inside its sentences (roles, content kinds, outcomes) and their keys. */
const WORDS: Record<string, Key> = {
  owner: 'n.role.owner',
  manager: 'n.role.manager',
  worker: 'n.role.worker',
  viewer: 'n.role.viewer',
  post: 'n.kind.post',
  comment: 'n.kind.comment',
  video: 'n.kind.video',
  'live stream': 'n.kind.liveStream',
  identity: 'n.registration.identity',
  'farm owner': 'n.registration.farmOwner',
  seller: 'n.registration.seller',
  approved: 'n.outcome.approved',
  rejected: 'n.outcome.rejected',
  suspended: 'n.outcome.suspended',
  'no action needed': 'n.outcome.noAction',
  'action taken': 'n.outcome.actionTaken',
};
const TRANSLATED_PARAMS = new Set(['role', 'kind', 'type', 'outcome']);

function reword(t: InboxT, variants: Variant[], text: string): string | undefined {
  for (const variant of variants) {
    const match = variant.re.exec(text);
    if (!match) continue;
    const params: Record<string, string> = {};
    variant.names.forEach((name, i) => {
      const value = match[i + 1] ?? '';
      const word = TRANSLATED_PARAMS.has(name) ? WORDS[value] : undefined;
      params[name] = word ? t(word) : value;
    });
    return t(variant.key, params);
  }
  return undefined;
}

/** A notification's title and body in the reader's language. English is shown exactly as the API sent it. */
export function notificationText(
  t: InboxT,
  locale: Locale,
  n: Pick<NotificationDTO, 'type' | 'category' | 'title' | 'body'>,
): { title: string; body: string } {
  if (locale === 'en') return { title: n.title, body: n.body };
  const spec = SPECS[n.type] as Spec | undefined;
  return {
    title: (spec && reword(t, spec.title, n.title)) ?? t(`category.${n.category}`),
    body: (spec && reword(t, spec.body, n.body)) ?? n.body,
  };
}
