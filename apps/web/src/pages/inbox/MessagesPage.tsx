import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  CHAT_LIMITS,
  REALTIME_EVENTS,
  REPORT_REASONS,
  type ConversationDTO,
  type MessageDTO,
  type MessagePage,
} from '@farmplus/shared-types';
import { api } from '../../api';
import { Alert, Button } from '../../components/ui';
import { errorMessage, formatDateTime } from '../../lib/format';
import { useT } from '../../i18n';
import { useInbox } from '../../lib/inbox';
import '../../components/inbox/inbox.css';

const newClientId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `c-${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** Upper bound on pages fetched when catching up after a reconnect (50 messages each). */
const CATCH_UP_MAX_PAGES = 20;

interface Pending {
  clientId: string;
  body: string;
  failed?: string;
}

/** `/messages` and `/messages/:conversationId` — buyer ↔ farm chat. The server decides every permission. */
export default function MessagesPage() {
  const { conversationId } = useParams();
  const { client, refresh } = useInbox();
  const t = useT('inbox');
  const [convs, setConvs] = useState<ConversationDTO[]>([]);
  const [listError, setListError] = useState<string>();
  const [loadingList, setLoadingList] = useState(true);

  const loadList = useCallback(async () => {
    try {
      const res = await api.request<{ items: ConversationDTO[] }>('GET', '/conversations', {
        query: { limit: 50 },
      });
      setConvs(res.items);
      setListError(undefined);
    } catch (e) {
      setListError(errorMessage(e));
    } finally {
      setLoadingList(false);
    }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(() => loadList());
  }, [loadList]);
  useEffect(() => {
    if (!client) return;
    const offUpdate = client.on(REALTIME_EVENTS.conversation, () => void loadList());
    const offResync = client.onResync(() => void loadList());
    return () => {
      offUpdate();
      offResync();
    };
  }, [client, loadList]);

  return (
    <div>
      <h1>{t('messages.title')}</h1>
      <div className="chat" data-open={Boolean(conversationId)}>
        <nav className="chat-list" aria-label={t('messages.conversations')}>
          {listError && <Alert tone="danger">{listError}</Alert>}
          {!loadingList && convs.length === 0 && !listError && <p>{t('messages.empty')}</p>}
          {convs.map((c) => (
            <Link
              key={c.id}
              to={`/messages/${c.id}`}
              className="chat-conv"
              aria-current={c.id === conversationId}
            >
              <strong>
                {c.counterpartName}
                {c.unread > 0 && (
                  <span
                    className="inbox-badge"
                    style={{ position: 'static', display: 'inline-block', marginLeft: 6 }}
                  >
                    {c.unread}
                  </span>
                )}
              </strong>
              {c.subject && <span className="inbox-muted">{c.subject.title}</span>}
              <span className="inbox-muted">
                {c.lastMessage ? c.lastMessage.preview : t('messages.noMessages')}
              </span>
            </Link>
          ))}
        </nav>
        <section className="chat-thread" aria-label={t('messages.conversation')}>
          {conversationId ? (
            <Thread
              key={conversationId}
              id={conversationId}
              onChanged={() => {
                void loadList();
                refresh();
              }}
            />
          ) : (
            <p style={{ padding: '1rem' }}>{t('messages.choose')}</p>
          )}
        </section>
      </div>
    </div>
  );
}

function Thread({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { client, state } = useInbox();
  const t = useT('inbox');
  const navigate = useNavigate();
  const [conv, setConv] = useState<ConversationDTO>();
  const [messages, setMessages] = useState<MessageDTO[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState('');
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const lastSeq = useRef(0);
  // The parent passes a fresh callback on every render; depending on it directly would reload the thread each time.
  const changed = useRef(onChanged);
  useEffect(() => {
    changed.current = onChanged;
  });
  const logRef = useRef<HTMLDivElement>(null);

  const merge = useCallback((incoming: MessageDTO[]) => {
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, m);
      const all = [...byId.values()].sort((a, b) => a.seq - b.seq);
      lastSeq.current = all.at(-1)?.seq ?? 0;
      return all;
    });
  }, []);

  const markRead = useCallback(async () => {
    try {
      const res = await api.request<{ updated: number }>('POST', `/conversations/${id}/read`, {
        body: {},
      });
      if (res.updated > 0) changed.current();
    } catch {
      /* the next message or refresh retries */
    }
  }, [id]);

  const loadInitial = useCallback(async () => {
    try {
      const [c, page] = await Promise.all([
        api.request<{ conversation: ConversationDTO }>('GET', `/conversations/${id}`),
        api.request<MessagePage>('GET', `/conversations/${id}/messages`, { query: { limit: 30 } }),
      ]);
      setConv(c.conversation);
      merge(page.items);
      setHasMore(page.hasMore);
      setError(undefined);
      void markRead();
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id, merge, markRead]);
  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  // Catch up from the last message we have (after a reconnect), then keep listening.
  const catchUp = useCallback(async () => {
    try {
      let fetched = 0;
      let after = lastSeq.current;
      // Follow every page of what was missed (bounded, so a misbehaving server cannot loop forever).
      for (let i = 0; i < CATCH_UP_MAX_PAGES; i++) {
        const page = await api.request<MessagePage>('GET', `/conversations/${id}/messages`, {
          query: { after, limit: 50 },
        });
        merge(page.items);
        fetched += page.items.length;
        const last = Math.max(after, ...page.items.map((m) => m.seq));
        if (!page.hasMore || last <= after) break;
        after = last;
      }
      if (fetched) void markRead();
    } catch {
      /* try again on the next resync */
    }
  }, [id, merge, markRead]);

  useEffect(() => {
    if (!client) return;
    void client.join(id);
    const offMsg = client.on(
      REALTIME_EVENTS.message,
      (p: { conversationId: string; message: Omit<MessageDTO, 'mine' | 'readAt'> }) => {
        if (p.conversationId !== id) return;
        setConv((c) => {
          if (c) merge([{ ...p.message, mine: p.message.side === c.myRole, readAt: null }]);
          return c;
        });
        void markRead();
      },
    );
    const offRead = client.on(
      REALTIME_EVENTS.read,
      (p: { conversationId: string; readerSide: string }) => {
        if (p.conversationId !== id) return;
        setMessages((prev) =>
          prev.map((m) => (m.mine && !m.readAt ? { ...m, readAt: new Date().toISOString() } : m)),
        );
      },
    );
    const offRevoked = client.on(
      REALTIME_EVENTS.conversation,
      (p: { conversationId: string; revoked?: boolean }) => {
        if (p.conversationId === id && p.revoked) {
          // Show the reason in place (do not silently bounce to the list), and drop everything that was displayed.
          setConv(undefined);
          setMessages([]);
          setRevoked(true);
        }
      },
    );
    const offResync = client.onResync(() => void catchUp());
    return () => {
      offMsg();
      offRead();
      offRevoked();
      offResync();
      client.leave(id);
    };
  }, [client, id, merge, markRead, catchUp, navigate]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight; // (assignment works everywhere; scrollTo is missing in some environments)
  }, [messages.length, pending.length]);

  const loadEarlier = async () => {
    const first = messages[0]?.seq;
    if (!first) return;
    try {
      const page = await api.request<MessagePage>('GET', `/conversations/${id}/messages`, {
        query: { before: first, limit: 30 },
      });
      merge(page.items);
      setHasMore(page.hasMore);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const send = async (item: Pending) => {
    setPending((p) =>
      p.some((x) => x.clientId === item.clientId)
        ? p.map((x) => (x.clientId === item.clientId ? { ...x, failed: undefined } : x))
        : [...p, item],
    );
    try {
      // The same clientId on a retry returns the original message instead of sending it twice.
      const res = await api.request<{ message: MessageDTO }>(
        'POST',
        `/conversations/${id}/messages`,
        { body: { body: item.body, clientId: item.clientId } },
      );
      merge([res.message]);
      setPending((p) => p.filter((x) => x.clientId !== item.clientId));
      changed.current();
    } catch (e) {
      setPending((p) =>
        p.map((x) => (x.clientId === item.clientId ? { ...x, failed: errorMessage(e) } : x)),
      );
    }
  };
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || body.length > CHAT_LIMITS.body) return;
    setDraft('');
    void send({ clientId: newClientId(), body });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const toggleBlock = async () => {
    if (!conv) return;
    try {
      const res = await api.request<{ conversation: ConversationDTO }>(
        conv.blocked === 'byYou' ? 'DELETE' : 'POST',
        `/conversations/${id}/block`,
      );
      setConv(res.conversation);
      changed.current();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  // (shown in place of the thread; worded at render time so it follows the language)
  const shownError = revoked ? t('thread.revoked') : error;
  if (shownError && !conv) return <Alert tone="danger">{shownError}</Alert>;
  if (!conv)
    return (
      <p role="status" style={{ padding: '1rem' }}>
        {t('loading')}
      </p>
    );
  const cannotSend = conv.blocked !== null;
  return (
    <>
      <div
        className="ds-row"
        style={{
          justifyContent: 'space-between',
          padding: '0.6rem 0.8rem',
          borderBottom: '1px solid var(--ds-border, #ccc)',
        }}
      >
        <div>
          <Link to="/messages" className="inbox-muted">
            {t('thread.back')}
          </Link>
          <h2 style={{ margin: 0 }}>{conv.counterpartName}</h2>
          {conv.subject && (
            <span className="inbox-muted">{t('thread.about', { title: conv.subject.title })}</span>
          )}
        </div>
        <span className="ds-row">
          <Button size="sm" onClick={() => setReporting((r) => !r)} aria-expanded={reporting}>
            {t('thread.report')}
          </Button>
          <Button size="sm" onClick={() => void toggleBlock()}>
            {conv.blocked === 'byYou' ? t('thread.unblock') : t('thread.block')}
          </Button>
        </span>
      </div>
      {state === 'reconnecting' && <Alert tone="warning">{t('thread.reconnecting')}</Alert>}
      {shownError && <Alert tone="danger">{shownError}</Alert>}
      {reported && <Alert tone="success">{t('report.thanks')}</Alert>}
      {conv.blocked === 'byYou' && <Alert tone="info">{t('thread.blockedByYou')}</Alert>}
      {conv.blocked === 'unavailable' && <Alert tone="info">{t('thread.unavailable')}</Alert>}
      {reporting && (
        <ReportForm
          id={id}
          onDone={() => {
            setReporting(false);
            setReported(true);
          }}
        />
      )}
      <div
        className="chat-log"
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label={t('thread.log')}
      >
        {hasMore && (
          <Button size="sm" onClick={() => void loadEarlier()}>
            {t('thread.loadEarlier')}
          </Button>
        )}
        {messages.map((m) => (
          <div key={m.id} className="chat-msg" data-mine={m.mine}>
            <small>
              {m.mine
                ? conv.myRole === 'seller'
                  ? m.senderName
                  : t('thread.you')
                : m.side === 'seller'
                  ? `${m.senderName} · ${conv.farmName}`
                  : m.senderName}{' '}
              · {formatDateTime(m.createdAt)}
              {m.mine && ` · ${m.readAt ? t('thread.read') : t('thread.sent')}`}
            </small>
            {m.body}
          </div>
        ))}
        {pending.map((p) => (
          <div key={p.clientId} className="chat-msg" data-mine="true" style={{ opacity: 0.7 }}>
            <small>{p.failed ? t('thread.notSent') : t('thread.sending')}</small>
            {p.body}
            {p.failed && (
              <div role="alert">
                {p.failed}{' '}
                <Button size="sm" onClick={() => void send(p)}>
                  {t('thread.retry')}
                </Button>{' '}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPending((x) => x.filter((y) => y.clientId !== p.clientId))}
                >
                  {t('thread.discard')}
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
      <form className="chat-composer" onSubmit={submit}>
        <textarea
          aria-label={t('thread.write')}
          value={draft}
          maxLength={CHAT_LIMITS.body}
          disabled={cannotSend}
          placeholder={cannotSend ? t('thread.cannotSend') : t('thread.placeholder')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
        />
        <Button type="submit" variant="primary" disabled={cannotSend || draft.trim().length === 0}>
          {t('send')}
        </Button>
      </form>
    </>
  );
}

function ReportForm({ id, onDone }: { id: string; onDone: () => void }) {
  const t = useT('inbox');
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number]>('abuse');
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string>();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.request('POST', `/conversations/${id}/report`, {
        body: { reason, ...(details.trim() ? { details: details.trim() } : {}) },
      });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <form
      onSubmit={(e) => void submit(e)}
      style={{ padding: '0.6rem 0.8rem' }}
      aria-label={t('report.aria')}
    >
      <p className="inbox-muted">{t('report.intro')}</p>
      {error && <Alert tone="danger">{error}</Alert>}
      <label>
        {t('report.reason')}{' '}
        <select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
          {REPORT_REASONS.map((r) => (
            <option key={r} value={r}>
              {t(`reason.${r}`)}
            </option>
          ))}
        </select>
      </label>{' '}
      <label>
        {t('report.details')}{' '}
        <input value={details} maxLength={500} onChange={(e) => setDetails(e.target.value)} />
      </label>{' '}
      <Button type="submit" variant="danger" size="sm">
        {t('report.send')}
      </Button>
    </form>
  );
}
