import { Router } from 'express';
import {
  conversationListQuerySchema,
  markAllReadSchema,
  markConversationReadSchema,
  messageListQuerySchema,
  messageReportListQuerySchema,
  notificationListQuerySchema,
  notificationPreferencesSchema,
  reportMessageSchema,
  resolveMessageReportSchema,
  sendMessageSchema,
  startConversationSchema,
} from '@farmplus/validation';
import type { AppContext } from '../../context';
import { forbidden } from '../../lib/errors';
import { parse, requireActor } from '../../lib/http';
import { parseObjectId } from '../../lib/object-id';
import { authenticate } from '../../middleware/authenticate';
import { rateLimits } from '../../middleware/rate-limit';
import {
  deleteNotification,
  getPreferences,
  listNotifications,
  markAllRead,
  markRead,
  updatePreferences,
} from '../notifications/service';
import { unreadCounts } from '../notifications/unread';
import {
  blockConversation,
  getConversation,
  listConversations,
  listMessages,
  markConversationRead,
  sendMessage,
  startConversation,
  unblockConversation,
} from './chat.service';
import {
  getReport,
  liftRestriction,
  listReports,
  reportMessage,
  resolveReport,
} from './reports.service';

/** `/api/v1/notifications` — the caller's own notifications, unread counters and preferences. */
export function notificationsRouter(ctx: AppContext): Router {
  const router = Router();
  const limits = rateLimits(ctx.env);
  router.use(authenticate(ctx));
  router.get('/', limits.notifications, async (req, res) => {
    res.json(
      await listNotifications(
        requireActor(req).userId,
        parse(notificationListQuerySchema, req.query),
      ),
    );
  });
  router.get('/unread-count', limits.notifications, async (req, res) => {
    res.json(await unreadCounts(requireActor(req).userId));
  });
  router.get('/preferences', limits.notifications, async (req, res) => {
    res.json(await getPreferences(requireActor(req).userId));
  });
  router.put('/preferences', limits.notifications, async (req, res) => {
    const body = parse(notificationPreferencesSchema, req.body);
    res.json(await updatePreferences(requireActor(req).userId, body.categories));
  });
  router.post('/read-all', limits.notifications, async (req, res) => {
    const body = parse(markAllReadSchema, req.body ?? {});
    res.json(await markAllRead(requireActor(req).userId, body.category));
  });
  router.post('/:id/read', limits.notifications, async (req, res) => {
    res.json({
      notification: await markRead(requireActor(req).userId, parseObjectId(req.params['id'])),
    });
  });
  router.delete('/:id', limits.notifications, async (req, res) => {
    await deleteNotification(requireActor(req).userId, parseObjectId(req.params['id']));
    res.status(204).end();
  });
  return router;
}

/** `/api/v1/conversations` — buyer ↔ farm chat. Every route authorizes the caller against the conversation. */
export function conversationsRouter(ctx: AppContext): Router {
  const router = Router();
  const limits = rateLimits(ctx.env);
  router.use(authenticate(ctx));
  router.get('/', limits.chatRead, async (req, res) => {
    res.json(
      await listConversations(requireActor(req), parse(conversationListQuerySchema, req.query)),
    );
  });
  router.post('/', limits.chatSend, async (req, res) => {
    res
      .status(201)
      .json(await startConversation(requireActor(req), parse(startConversationSchema, req.body)));
  });
  router.get('/:id', limits.chatRead, async (req, res) => {
    res.json({
      conversation: await getConversation(requireActor(req), parseObjectId(req.params['id'])),
    });
  });
  router.get('/:id/messages', limits.chatRead, async (req, res) => {
    res.json(
      await listMessages(
        requireActor(req),
        parseObjectId(req.params['id']),
        parse(messageListQuerySchema, req.query),
      ),
    );
  });
  router.post('/:id/messages', limits.chatSend, async (req, res) => {
    const message = await sendMessage(
      requireActor(req),
      parseObjectId(req.params['id']),
      parse(sendMessageSchema, req.body),
    );
    res.status(201).json({ message });
  });
  router.post('/:id/read', limits.chatRead, async (req, res) => {
    parse(markConversationReadSchema, req.body ?? {});
    res.json(await markConversationRead(requireActor(req), parseObjectId(req.params['id'])));
  });
  router.post('/:id/block', limits.chatRead, async (req, res) => {
    res.json({
      conversation: await blockConversation(requireActor(req), parseObjectId(req.params['id'])),
    });
  });
  router.delete('/:id/block', limits.chatRead, async (req, res) => {
    res.json({
      conversation: await unblockConversation(requireActor(req), parseObjectId(req.params['id'])),
    });
  });
  router.post('/:id/report', limits.report, async (req, res) => {
    res
      .status(201)
      .json(
        await reportMessage(
          requireActor(req),
          parseObjectId(req.params['id']),
          parse(reportMessageSchema, req.body),
        ),
      );
  });
  return router;
}

/** `/api/v1/admin/chat` — moderation of reported messages (`content.moderate`). Moderators never browse conversations. */
export function adminChatRouter(ctx: AppContext): Router {
  const router = Router();
  const limits = rateLimits(ctx.env);
  router.use(authenticate(ctx));
  router.use((req, _res, next) => {
    if (!requireActor(req).access.permissions.has('content.moderate')) throw forbidden();
    next();
  });
  router.get('/reports', limits.chatRead, async (req, res) => {
    res.json(await listReports(parse(messageReportListQuerySchema, req.query)));
  });
  router.get('/reports/:id', limits.chatRead, async (req, res) => {
    res.json({ report: await getReport(parseObjectId(req.params['id'])) });
  });
  router.post('/reports/:id/resolve', limits.chatRead, async (req, res) => {
    res.json({
      report: await resolveReport(
        requireActor(req),
        parseObjectId(req.params['id']),
        parse(resolveMessageReportSchema, req.body),
      ),
    });
  });
  router.delete('/restrictions/:userId', limits.chatRead, async (req, res) => {
    await liftRestriction(requireActor(req), parseObjectId(req.params['userId']));
    res.status(204).end();
  });
  return router;
}
