/**
 * Notifications & messaging (Part 17). In-app only: nothing here sends e-mail, SMS or push.
 * Notification text never contains another user's free text (offer notes, chat messages): only facts the
 * recipient is entitled to, and a link to the screen that shows the details under that screen's own permissions.
 */
export const NOTIFICATION_CATEGORIES = [
  'orders',
  'offers',
  'farm',
  'moderation',
  'messages',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** Orders and moderation outcomes affect money and account standing, so they cannot be switched off. */
export const LOCKED_CATEGORIES: readonly NotificationCategory[] = ['orders', 'moderation'];

export const NOTIFICATION_CATEGORY_LABEL: Record<NotificationCategory, string> = {
  orders: 'Orders & shipping',
  offers: 'Offers & counter-offers',
  farm: 'Farm activity',
  moderation: 'Moderation & account decisions',
  messages: 'Messages',
};

export const NOTIFICATION_TYPES = [
  'order.placed',
  'order.paid',
  'order.processing',
  'order.shipped',
  'order.delivered',
  'order.cancelled',
  'order.refund_pending',
  'order.refunded',
  'order.payment_expired',
  'offer.received',
  'offer.countered',
  'offer.accepted',
  'offer.rejected',
  'offer.withdrawn',
  'farm.member_added',
  'farm.member_removed',
  'farm.member_role_changed',
  'farm.sale_completed',
  'moderation.listing_approved',
  'moderation.listing_rejected',
  'moderation.listing_suspended',
  'moderation.listing_restored',
  'moderation.product_approved',
  'moderation.product_rejected',
  'moderation.product_suspended',
  'moderation.product_restored',
  'moderation.content_hidden',
  'moderation.content_removed',
  'moderation.content_restored',
  'moderation.registration_decided',
  'moderation.message_report_resolved',
  'moderation.message_warning',
  'message.new',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

const PREFIX_CATEGORY: Record<string, NotificationCategory> = {
  order: 'orders',
  offer: 'offers',
  farm: 'farm',
  moderation: 'moderation',
  message: 'messages',
};
export const categoryOf = (type: NotificationType): NotificationCategory =>
  PREFIX_CATEGORY[type.split('.')[0]!]!;

export interface NotificationDTO {
  id: string;
  type: NotificationType;
  category: NotificationCategory;
  title: string;
  body: string;
  /** App path that shows the details (opened under that screen's own permissions). */
  link: string | null;
  /** More than 1 when several events of one kind were folded together (e.g. new chat messages). */
  count: number;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  items: NotificationDTO[];
  nextCursor?: string;
  unread: number;
}

export interface UnreadCounts {
  notifications: number;
  messages: number;
  byCategory: Partial<Record<NotificationCategory, number>>;
}

export interface NotificationPreferencesDTO {
  categories: Record<NotificationCategory, { inApp: boolean; locked: boolean }>;
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------
export const CHAT_LIMITS = { body: 2000, preview: 120 } as const;
export type ChatSide = 'buyer' | 'seller';

export interface ConversationDTO {
  id: string;
  farmId: string;
  farmName: string;
  /** Which side the caller is on: the buyer, or the farm's owners/managers. */
  myRole: ChatSide;
  /** The other party as the caller may see them: the buyer's display name, or the farm's name. */
  counterpartName: string;
  subject: { type: 'listing' | 'product'; id: string; title: string } | null;
  lastMessage: { preview: string; at: string; side: ChatSide } | null;
  unread: number;
  /** `byYou` when the caller blocked the conversation; `unavailable` when the other side did (not attributed). */
  blocked: 'byYou' | 'unavailable' | null;
  createdAt: string;
}

export interface MessageDTO {
  id: string;
  conversationId: string;
  seq: number;
  side: ChatSide;
  /** Sent by the caller's side of the conversation (the buyer, or anyone on the farm's seller side). */
  mine: boolean;
  senderName: string;
  body: string;
  createdAt: string;
  /** When the other side read it (only shown for the caller's own messages). */
  readAt: string | null;
}

export interface MessagePage {
  items: MessageDTO[];
  /** True when older messages exist before the first item returned. */
  hasMore: boolean;
}

export const MESSAGE_REPORT_STATUSES = ['open', 'actioned', 'dismissed'] as const;
export type MessageReportStatus = (typeof MESSAGE_REPORT_STATUSES)[number];
export const MESSAGE_REPORT_ACTIONS = ['dismiss', 'warn', 'restrict_messaging'] as const;
export type MessageReportAction = (typeof MESSAGE_REPORT_ACTIONS)[number];

export interface MessageReportDTO {
  id: string;
  status: MessageReportStatus;
  reason: string;
  details: string | null;
  reporterName: string;
  reportedName: string;
  reportedUserId: string;
  /** The reported message and the few before it, as they were when reported. */
  evidence: { side: ChatSide; senderName: string; body: string; at: string; reported: boolean }[];
  resolution: { action: MessageReportAction; note: string | null; at: string } | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Realtime (Socket.IO)
// ---------------------------------------------------------------------------
export const REALTIME_EVENTS = {
  notification: 'notification:new',
  unread: 'unread:update',
  message: 'message:new',
  read: 'message:read',
  conversation: 'conversation:update',
  joinConversation: 'conversation:join',
  leaveConversation: 'conversation:leave',
  authExpired: 'auth:expired',
} as const;
