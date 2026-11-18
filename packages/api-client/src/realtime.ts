/* eslint-disable @typescript-eslint/no-explicit-any -- server payloads are untyped here; callers narrow them */
import { io as socketIo, type Socket } from 'socket.io-client';
import { REALTIME_EVENTS } from '@farmplus/shared-types';

export type RealtimeState = 'connecting' | 'connected' | 'reconnecting' | 'signed_out' | 'closed';

export interface RealtimeOptions {
  /** Origin of the API (same one the REST client uses). Empty string = same origin. */
  url: string;
  path?: string;
  /** The current access token. Called for every connection attempt, so a refreshed token is always used. */
  getToken: () => string | null | undefined | Promise<string | null | undefined>;
  /** Try to get a fresh access token (e.g. refresh the session). Resolve false when the user must sign in again. */
  refreshToken?: () => Promise<boolean>;
  minDelayMs?: number;
  maxDelayMs?: number;
  /** Injection point for tests. */
  connect?: typeof socketIo;
}

export interface RealtimeClient {
  readonly state: RealtimeState;
  /** Subscribe to a server event. Returns an unsubscribe function. */
  on(event: string, handler: (payload: any) => void): () => void;
  onState(handler: (state: RealtimeState) => void): () => void;
  /**
   * Subscribe to a conversation. The subscription is remembered and re-requested after every reconnect (the server
   * never restores rooms by itself: each join is authorized again). Resolves with the server's answer.
   */
  join(conversationId: string): Promise<{ ok: boolean; error?: string; role?: string }>;
  leave(conversationId: string): void;
  /**
   * Called after every (re)connection that follows a gap. Events are hints, not a log: on resync the UI must refetch
   * what it shows (unread counters, the open conversation from its last message number).
   */
  onResync(handler: () => void): () => void;
  /** Reconnect now (e.g. after the user signed in again or the browser came back online). */
  reconnect(): void;
  close(): void;
}

const AUTH_CODES = new Set([
  'UNAUTHENTICATED',
  'INVALID_TOKEN',
  'SESSION_REVOKED',
  'ACCOUNT_INACTIVE',
]);

/**
 * Socket.IO client with the recovery rules the server expects:
 *  - Socket.IO retries transport drops by itself, but NOT when the server ends the connection (token expired, session
 *    revoked) or rejects the handshake — so those are retried here, after refreshing the token, with exponential backoff.
 *  - If the session cannot be refreshed the client stops (`signed_out`) instead of hammering the server.
 *  - Rooms are re-joined (and re-authorized) after each reconnect; losing access reports `revoked`.
 */
export function createRealtimeClient(options: RealtimeOptions): RealtimeClient {
  const connectFn = options.connect ?? socketIo;
  const minDelay = options.minDelayMs ?? 1000;
  const maxDelay = options.maxDelayMs ?? 30_000;
  const rooms = new Set<string>();
  const stateHandlers = new Set<(s: RealtimeState) => void>();
  const resyncHandlers = new Set<() => void>();
  const listeners = new Map<string, Set<(p: any) => void>>();
  let state: RealtimeState = 'connecting';
  let closed = false;
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hasConnected = false;
  let tokenStale = false;

  const setState = (next: RealtimeState) => {
    if (state === next) return;
    state = next;
    stateHandlers.forEach((h) => h(next));
  };

  const socket: Socket = connectFn(options.url, {
    path: options.path ?? '/socket.io',
    transports: ['websocket', 'polling'],
    autoConnect: false,
    reconnection: true, // transport drops
    reconnectionDelay: minDelay,
    reconnectionDelayMax: maxDelay,
    auth: (cb) => {
      Promise.resolve(options.getToken()).then(
        (token) => cb({ token: token ?? '' }),
        () => cb({ token: '' }),
      );
    },
  });

  const emitLocal = (event: string, payload: unknown) =>
    listeners.get(event)?.forEach((h) => h(payload));

  /** Manual reconnect with backoff, used when Socket.IO will not retry by itself. */
  const scheduleReconnect = (refresh: boolean) => {
    if (closed || timer) return;
    setState('reconnecting');
    const delay = Math.min(maxDelay, minDelay * 2 ** attempts++);
    timer = setTimeout(async () => {
      timer = undefined;
      if (closed) return;
      if (refresh || tokenStale) {
        const ok = options.refreshToken ? await options.refreshToken().catch(() => false) : false;
        if (!ok) {
          setState('signed_out');
          return;
        }
        tokenStale = false;
      }
      socket.connect();
    }, delay);
  };

  socket.on('connect', async () => {
    attempts = 0;
    const regained = hasConnected;
    hasConnected = true;
    setState('connected');
    for (const id of [...rooms]) {
      try {
        const res = await socket
          .timeout(5000)
          .emitWithAck(REALTIME_EVENTS.joinConversation, { conversationId: id });
        if (!res?.ok) {
          rooms.delete(id);
          emitLocal(REALTIME_EVENTS.conversation, { conversationId: id, revoked: true });
        }
      } catch {
        /* the next reconnect retries */
      }
    }
    if (regained) resyncHandlers.forEach((h) => h());
  });
  socket.on('disconnect', (reason) => {
    if (closed) return;
    if (reason === 'io server disconnect')
      scheduleReconnect(tokenStale); // the server ended it: Socket.IO will not retry
    else if (reason !== 'io client disconnect') setState('reconnecting');
  });
  socket.on('connect_error', (error: Error & { data?: { code?: string } }) => {
    if (closed) return;
    if (error.data?.code && AUTH_CODES.has(error.data.code)) {
      tokenStale = true;
      scheduleReconnect(true);
    } else if (!socket.active) scheduleReconnect(false);
    else setState('reconnecting');
  });
  socket.on(REALTIME_EVENTS.authExpired, () => {
    tokenStale = true;
  });
  // Forward server events to subscribers (registered lazily, once per event name).
  const bound = new Set<string>();
  const bind = (event: string) => {
    if (bound.has(event)) return;
    bound.add(event);
    socket.on(event, (payload) => emitLocal(event, payload));
  };

  socket.connect();

  return {
    get state() {
      return state;
    },
    on(event, handler) {
      bind(event);
      let set = listeners.get(event);
      if (!set) listeners.set(event, (set = new Set()));
      set.add(handler);
      return () => set.delete(handler);
    },
    onState(handler) {
      stateHandlers.add(handler);
      return () => stateHandlers.delete(handler);
    },
    async join(conversationId) {
      rooms.add(conversationId);
      if (!socket.connected) return { ok: false, error: 'OFFLINE' }; // joined automatically on connect
      try {
        const res = await socket
          .timeout(5000)
          .emitWithAck(REALTIME_EVENTS.joinConversation, { conversationId });
        if (!res?.ok) rooms.delete(conversationId);
        return res;
      } catch {
        return { ok: false, error: 'TIMEOUT' };
      }
    },
    leave(conversationId) {
      rooms.delete(conversationId);
      if (socket.connected) socket.emit(REALTIME_EVENTS.leaveConversation, { conversationId });
    },
    onResync(handler) {
      resyncHandlers.add(handler);
      return () => resyncHandlers.delete(handler);
    },
    reconnect() {
      if (closed) return;
      if (timer) clearTimeout(timer);
      timer = undefined;
      attempts = 0;
      if (!socket.connected) socket.connect();
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      socket.close();
      setState('closed');
    },
  };
}
