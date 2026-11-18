import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  createRealtimeClient,
  type RealtimeClient,
  type RealtimeState,
} from '@farmplus/api-client/realtime';
import { REALTIME_EVENTS, type UnreadCounts } from '@farmplus/shared-types';
import { api, refreshSession } from '../api';
import { AuthContext } from '../auth/AuthContext';
import { tokenStore } from '../auth/tokens';

export interface InboxValue {
  counts: UnreadCounts;
  /** Live connection (null when signed out). Pages subscribe to events and conversations through it. */
  client: RealtimeClient | null;
  state: RealtimeState | 'offline';
  /** Re-read the counters from the API (the source of truth). */
  refresh: () => void;
}

const EMPTY: UnreadCounts = { notifications: 0, messages: 0, byCategory: {} };
const InboxContext = createContext<InboxValue>({
  counts: EMPTY,
  client: null,
  state: 'offline',
  refresh: () => undefined,
});
export const useInbox = (): InboxValue => useContext(InboxContext);

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? '';

/**
 * Keeps the unread counters and the realtime connection for the signed-in user. The counters always come from the
 * API; realtime events are only a nudge, and everything is re-read after a reconnect, when the tab regains focus
 * and when the browser comes back online — so a missed event can never leave a stale badge for long.
 */
export function InboxProvider({ children }: { children: ReactNode }) {
  const auth = useContext(AuthContext);
  const signedIn = auth?.status === 'authenticated';
  const [counts, setCounts] = useState<UnreadCounts>(EMPTY);
  const [client, setClient] = useState<RealtimeClient | null>(null);
  const [state, setState] = useState<RealtimeState | 'offline'>('offline');
  const alive = useRef(true);

  const refresh = useCallback(() => {
    api
      .request<UnreadCounts>('GET', '/notifications/unread-count')
      .then((c) => alive.current && setCounts(c))
      .catch(() => undefined); // keep the last known value; the next event or refresh corrects it
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!signedIn) return; // (the values below fall back to "nothing" while signed out)
    refresh();
    const rt = createRealtimeClient({
      url: baseUrl,
      getToken: tokenStore.getAccess,
      refreshToken: refreshSession,
    });
    queueMicrotask(() => {
      // (not synchronously inside the effect)
      setClient(rt);
      setState(rt.state);
    });
    const offState = rt.onState(setState);
    const offUnread = rt.on(REALTIME_EVENTS.unread, (c: UnreadCounts) => setCounts(c));
    const offResync = rt.onResync(refresh);
    const onFocus = () => {
      refresh();
      rt.reconnect();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      offState();
      offUnread();
      offResync();
      rt.close();
      setClient(null);
    };
  }, [signedIn, refresh]);

  const value = useMemo(
    () => ({
      counts: signedIn ? counts : EMPTY,
      client: signedIn ? client : null,
      state: signedIn ? state : ('offline' as const),
      refresh,
    }),
    [signedIn, counts, client, state, refresh],
  );
  return <InboxContext.Provider value={value}>{children}</InboxContext.Provider>;
}
