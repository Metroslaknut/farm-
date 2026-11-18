import type { Server as HttpServer } from 'node:http';
import { reportError } from '../../lib/error-reporter';
import { Server, type Socket } from 'socket.io';
import type { ApiEnv } from '@farmplus/config/server';
import { REALTIME_EVENTS } from '@farmplus/shared-types';
import { joinConversationSchema } from '@farmplus/validation';
import type { TokenSigner } from '../../lib/jwt';
import { authenticateToken } from '../../middleware/authenticate';
import { accessConversation } from '../chat/chat.service';
import { parseObjectId } from '../../lib/object-id';
import { hub } from './hub';

export const RT_LIMITS = {
  /** Client events allowed per socket in a window; more are refused, and persistent abuse drops the connection. */
  eventsPerWindow: 20,
  windowMs: 10_000,
  disconnectAfterViolations: 50,
  maxRoomsPerSocket: 50,
  maxBufferBytes: 10_000,
  /** How often a live connection re-checks that its session and account are still valid. */
  recheckMs: 60_000,
} as const;

interface SocketData {
  userId: string;
  sessionId: string;
}

const fail = (code: string, message: string) => {
  const err = new Error(message) as Error & { data?: { code: string } };
  err.data = { code };
  return err;
};

type Ack = (response: { ok: boolean; error?: string; role?: string }) => void;

/**
 * Socket.IO server on the same HTTP server as the API.
 *  - **Authentication**: the access token (handshake `auth.token`) is verified exactly like an HTTP request — signature,
 *    live session, active account — before the connection is accepted. The connection never outlives the token, and is
 *    re-checked every minute so logout/suspension cuts it off.
 *  - **Authorization**: a socket automatically joins only `user:<its own id>`. Joining `conv:<id>` goes through the same
 *    `accessConversation` gate as the REST API; failure is indistinguishable from "no such conversation".
 *  - **Abuse control**: per-socket event budget, bounded payload size and room count, validated payloads.
 *  - Events are hints: clients refetch after a gap, so a missed event never loses data.
 */
export function attachRealtime(
  http: HttpServer,
  deps: { env: Pick<ApiEnv, 'CORS_ORIGINS'>; signer: TokenSigner; recheckMs?: number },
): Server {
  const io = new Server(http, {
    path: '/socket.io',
    serveClient: false,
    cors: { origin: deps.env.CORS_ORIGINS },
    maxHttpBufferSize: RT_LIMITS.maxBufferBytes,
    // Deliberately no connectionStateRecovery: it would restore rooms without re-authorizing them.
  });

  io.use(async (socket, next) => {
    const token: unknown = socket.handshake.auth?.['token'];
    if (typeof token !== 'string' || token.length === 0 || token.length > 4096)
      return next(fail('UNAUTHENTICATED', 'Authentication required'));
    try {
      const actor = await authenticateToken(deps, token, socket.handshake.address);
      (socket.data as SocketData) = { userId: actor.userId, sessionId: actor.sessionId };
      (socket as Socket & { _token: string; _exp: number })._token = token;
      (socket as Socket & { _token: string; _exp: number })._exp = actor.exp;
      next();
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'UNAUTHENTICATED';
      next(fail(code, 'Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    const { userId } = socket.data as SocketData;
    const s = socket as Socket & { _token: string; _exp: number };
    void socket.join(`user:${userId}`);

    // End the connection when the token expires or the session/account stops being valid; the client then refreshes
    // its token and reconnects.
    const expire = (reason: string) => {
      socket.emit(REALTIME_EVENTS.authExpired, { reason });
      socket.disconnect(true);
    };
    const untilExpiry = Math.max(0, s._exp * 1000 - Date.now());
    const expiryTimer = setTimeout(() => expire('token_expired'), untilExpiry);
    const recheck = setInterval(() => {
      authenticateToken(deps, s._token).catch(() => expire('session_ended'));
    }, deps.recheckMs ?? RT_LIMITS.recheckMs);
    expiryTimer.unref();
    recheck.unref();
    socket.on('disconnect', () => {
      clearTimeout(expiryTimer);
      clearInterval(recheck);
    });

    // Per-socket budget for client → server events.
    let windowStart = Date.now();
    let used = 0;
    let violations = 0;
    const allowed = (): boolean => {
      const now = Date.now();
      if (now - windowStart > RT_LIMITS.windowMs) {
        windowStart = now;
        used = 0;
      }
      if (++used <= RT_LIMITS.eventsPerWindow) return true;
      if (++violations >= RT_LIMITS.disconnectAfterViolations) socket.disconnect(true);
      return false;
    };
    const handle =
      (fn: (payload: unknown) => Promise<Parameters<Ack>[0]>) =>
      async (payload: unknown, ack?: Ack) => {
        const reply: Ack = typeof ack === 'function' ? ack : () => undefined;
        if (!allowed()) return reply({ ok: false, error: 'RATE_LIMITED' });
        try {
          reply(await fn(payload));
        } catch (error) {
          reportError(error, { source: 'job', route: 'realtime-handler' });
          reply({ ok: false, error: 'INTERNAL' });
        }
      };

    socket.on(
      REALTIME_EVENTS.joinConversation,
      handle(async (payload) => {
        const parsed = joinConversationSchema.safeParse(payload);
        if (!parsed.success) return { ok: false, error: 'INVALID' };
        const convRooms = [...socket.rooms].filter((r) => r.startsWith('conv:'));
        if (convRooms.length >= RT_LIMITS.maxRoomsPerSocket)
          return { ok: false, error: 'TOO_MANY_ROOMS' };
        // Same check as the REST API, against the live database. A conversation that is not yours "does not exist".
        const access = await accessConversation(userId, parseObjectId(parsed.data.conversationId));
        if (!access) return { ok: false, error: 'NOT_FOUND' };
        await socket.join(`conv:${String(access.conv._id)}`);
        return { ok: true, role: access.role };
      }),
    );
    socket.on(
      REALTIME_EVENTS.leaveConversation,
      handle(async (payload) => {
        const parsed = joinConversationSchema.safeParse(payload);
        if (!parsed.success) return { ok: false, error: 'INVALID' };
        // Rooms are named by the canonical (lower-case) id, as the hub emits to them.
        await socket.leave(`conv:${parsed.data.conversationId.toLowerCase()}`);
        return { ok: true };
      }),
    );
  });

  hub.attach(io, async (userId) => {
    for (const socket of await io.in(`user:${userId}`).fetchSockets()) {
      for (const room of socket.rooms) {
        if (!room.startsWith('conv:')) continue;
        const access = await accessConversation(userId, parseObjectId(room.slice(5)));
        if (!access) {
          socket.leave(room);
          socket.emit(REALTIME_EVENTS.conversation, {
            conversationId: room.slice(5),
            revoked: true,
          });
        }
      }
    }
  });
  io.engine.on('connection_error', () => undefined); // handled by the client's reconnect logic; never crash the process
  return io;
}

export async function closeRealtime(io: Server): Promise<void> {
  hub.detach();
  await io.close();
}
