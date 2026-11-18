/* eslint-disable @typescript-eslint/no-explicit-any -- request options and payloads are inspected loosely in tests */
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request }, refreshSession: vi.fn() }));
vi.mock('../src/auth/tokens', () => ({ tokenStore: { getAccess: () => 'tok' } }));

/** A controllable stand-in for the realtime client: tests fire server events by hand. */
const fake = vi.hoisted(() => {
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const resync = new Set<() => void>();
  const stateHandlers = new Set<(s: string) => void>();
  const client = {
    state: 'connected',
    on: vi.fn((event: string, h: (p: unknown) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(h);
      return () => handlers.get(event)!.delete(h);
    }),
    onState: vi.fn(
      (h: (s: string) => void) => (stateHandlers.add(h), () => stateHandlers.delete(h)),
    ),
    onResync: vi.fn((h: () => void) => (resync.add(h), () => resync.delete(h))),
    join: vi.fn(async () => ({ ok: true })),
    leave: vi.fn(),
    reconnect: vi.fn(),
    close: vi.fn(),
  };
  return {
    client,
    emit: (event: string, payload: unknown) => handlers.get(event)?.forEach((h) => h(payload)),
    resync: () => resync.forEach((h) => h()),
    setState: (s: string) => stateHandlers.forEach((h) => h(s)),
    reset: () => {
      handlers.clear();
      resync.clear();
      stateHandlers.clear();
      client.on.mockClear();
      client.join.mockClear();
      client.leave.mockClear();
      client.state = 'connected';
    },
  };
});
vi.mock('@farmplus/api-client/realtime', () => ({ createRealtimeClient: () => fake.client }));

import { AuthContext, withHelpers } from '../src/auth/AuthContext';
import { ContactSellerButton } from '../src/components/inbox/ContactSellerButton';
import { InboxLinks } from '../src/components/inbox/InboxLinks';
import { InboxProvider } from '../src/lib/inbox';
import MessageReportsPage from '../src/pages/admin/message-reports';
import MessagesPage from '../src/pages/inbox/MessagesPage';
import NotificationsPage from '../src/pages/inbox/NotificationsPage';
import { setLocale } from '../src/i18n';

const noop = async () => undefined;
const session = (status: 'authenticated' | 'anonymous' = 'authenticated') =>
  withHelpers(
    { status, permissions: [], mfaRequired: false },
    {
      login: async () => 'authenticated',
      completeSignIn: async () => 'authenticated',
      verifyMfa: noop,
      logout: noop,
      reload: noop,
    },
  );

function renderApp(
  ui: React.ReactElement,
  route = '/',
  status: 'authenticated' | 'anonymous' = 'authenticated',
) {
  return render(
    <AuthContext.Provider value={session(status)}>
      <InboxProvider>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </InboxProvider>
    </AuthContext.Provider>,
  );
}

const note = (over: object = {}) => ({
  id: 'n1',
  type: 'order.paid',
  category: 'orders',
  title: 'Payment received',
  body: 'We received your payment for order FP-1.',
  link: '/market/orders/o1',
  count: 1,
  readAt: null,
  createdAt: '2026-06-15T05:00:00.000Z',
  ...over,
});
const prefs = {
  categories: {
    orders: { inApp: true, locked: true },
    offers: { inApp: true, locked: false },
    farm: { inApp: true, locked: false },
    moderation: { inApp: true, locked: true },
    messages: { inApp: false, locked: false },
  },
};
const conv = (over: object = {}) => ({
  id: 'c1',
  farmId: 'f1',
  farmName: 'Happy Farm',
  myRole: 'buyer',
  counterpartName: 'Happy Farm',
  subject: { type: 'listing', id: 'l1', title: 'Swamp buffalo' },
  lastMessage: { preview: 'Hello', at: '2026-06-15T05:00:00.000Z', side: 'buyer' },
  unread: 0,
  blocked: null,
  createdAt: '2026-06-15T05:00:00.000Z',
  ...over,
});
const msg = (seq: number, side: 'buyer' | 'seller', body: string, over: object = {}) => ({
  id: `m${seq}`,
  conversationId: 'c1',
  seq,
  side,
  mine: side === 'buyer',
  senderName: side === 'buyer' ? 'Me' : 'Somchai',
  body,
  createdAt: '2026-06-15T05:00:00.000Z',
  readAt: null,
  ...over,
});
const calls = (method: string, re: RegExp) =>
  request.mock.calls.filter((c) => c[0] === method && re.test(String(c[1])));

beforeEach(() => {
  request.mockReset();
  fake.reset();
});
afterEach(cleanup);

describe('header counters', () => {
  it('shows unread counts from the API, follows live updates, and caps large numbers', async () => {
    request.mockResolvedValue({ notifications: 3, messages: 1, byCategory: {} });
    renderApp(<InboxLinks />);
    expect(await screen.findByRole('link', { name: 'Notifications, 3 unread' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Messages, 1 unread' })).toBeTruthy();
    act(() => fake.emit('unread:update', { notifications: 0, messages: 120, byCategory: {} }));
    expect(screen.getByRole('link', { name: 'Notifications, 0 unread' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Messages, 120 unread' }).textContent).toContain('99+');
  });

  it('re-reads the counters after a reconnect (events are only hints) and shows when live updates are reconnecting', async () => {
    request.mockResolvedValue({ notifications: 1, messages: 0, byCategory: {} });
    renderApp(<InboxLinks />);
    await screen.findByRole('link', { name: 'Notifications, 1 unread' });
    request.mockResolvedValue({ notifications: 4, messages: 0, byCategory: {} });
    act(() => fake.setState('reconnecting'));
    expect(screen.getByRole('status')).toBeTruthy();
    act(() => fake.resync());
    expect(await screen.findByRole('link', { name: 'Notifications, 4 unread' })).toBeTruthy();
  });

  it('renders nothing and opens no connection when signed out', () => {
    const { container } = renderApp(<InboxLinks />, '/', 'anonymous');
    expect(container.textContent).toBe('');
    expect(request).not.toHaveBeenCalled();
    expect(fake.client.on).not.toHaveBeenCalled();
  });
});

describe('notifications page', () => {
  beforeEach(() => {
    request.mockImplementation((method: string, path: string) => {
      if (path === '/notifications/unread-count')
        return Promise.resolve({ notifications: 1, messages: 0, byCategory: {} });
      if (path === '/notifications/preferences') return Promise.resolve(prefs);
      if (path === '/notifications' && method === 'GET')
        return Promise.resolve({
          items: [
            note(),
            note({ id: 'n2', title: 'Order shipped', readAt: '2026-06-15T06:00:00.000Z' }),
          ],
          unread: 1,
        });
      if (/\/read$/.test(path))
        return Promise.resolve({ notification: note({ readAt: '2026-06-15T07:00:00.000Z' }) });
      if (path === '/notifications/read-all') return Promise.resolve({ updated: 1 });
      return Promise.resolve(prefs);
    });
  });

  it('lists notifications with their text and link, marks one read, and refreshes the counter', async () => {
    renderApp(<NotificationsPage />);
    const item = (await screen.findByText('Payment received')).closest('li')!;
    expect(within(item).getByText(/FP-1/)).toBeTruthy();
    expect(within(item).getByRole('link', { name: 'Open' }).getAttribute('href')).toBe(
      '/market/orders/o1',
    );
    await userEvent.click(
      within(item).getByRole('button', { name: /Mark “Payment received” as read/ }),
    );
    await waitFor(() => expect(calls('POST', /\/notifications\/n1\/read$/)).toHaveLength(1));
    await waitFor(() => expect(item.getAttribute('data-unread')).toBe('false'));
    expect(calls('GET', /unread-count/).length).toBeGreaterThan(1);
    expect(
      within(screen.getByText('Order shipped').closest('li')!).queryByRole('button', {
        name: /Mark/,
      }),
    ).toBeNull(); // already read
  });

  it('filters by unread and category via the API, and marks everything read', async () => {
    renderApp(<NotificationsPage />);
    await screen.findByText('Payment received');
    await userEvent.click(screen.getByLabelText('Unread only'));
    await waitFor(() =>
      expect(calls('GET', /^\/notifications$/).at(-1)![2].query).toMatchObject({ unread: true }),
    );
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'offers');
    await waitFor(() =>
      expect(calls('GET', /^\/notifications$/).at(-1)![2].query).toMatchObject({
        category: 'offers',
        unread: true,
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));
    await waitFor(() =>
      expect(calls('POST', /read-all/)[0]![2].body).toEqual({ category: 'offers' }),
    );
  });

  it('shows a new notification the moment it arrives, once', async () => {
    renderApp(<NotificationsPage />);
    await screen.findByText('Payment received');
    act(() =>
      fake.emit(
        'notification:new',
        note({ id: 'n9', title: 'Brand new offer', category: 'offers' }),
      ),
    );
    act(() =>
      fake.emit(
        'notification:new',
        note({ id: 'n9', title: 'Brand new offer', category: 'offers' }),
      ),
    );
    expect(await screen.findAllByText('Brand new offer')).toHaveLength(1);
  });

  it('preferences: locked categories cannot be switched off; others send exactly that change', async () => {
    renderApp(<NotificationsPage />);
    const orders = (await screen.findByLabelText(/Orders & shipping/)) as HTMLInputElement;
    expect(orders.disabled).toBe(true);
    expect(orders.checked).toBe(true);
    expect(
      (screen.getByLabelText(/Moderation & account decisions/) as HTMLInputElement).disabled,
    ).toBe(true);
    const messages = screen.getByLabelText('Messages') as HTMLInputElement;
    expect(messages.checked).toBe(false);
    await userEvent.click(messages);
    await waitFor(() =>
      expect(calls('PUT', /preferences/)[0]![2].body).toEqual({
        categories: { messages: { inApp: true } },
      }),
    );
  });

  it('shows an error if the list cannot be loaded', async () => {
    request.mockImplementation((_m: string, path: string) =>
      path === '/notifications'
        ? Promise.reject(new Error('Server down'))
        : Promise.resolve(
            path.includes('pref') ? prefs : { notifications: 0, messages: 0, byCategory: {} },
          ),
    );
    renderApp(<NotificationsPage />);
    expect((await screen.findByRole('alert')).textContent).toContain('Server down');
  });
});

function chatRoutes(
  extra: (
    method: string,
    path: string,
    opts: { body?: any; query?: any },
  ) => unknown | undefined = () => undefined,
) {
  request.mockImplementation(
    (method: string, path: string, opts: { body?: any; query?: any } = {}) => {
      const custom = extra(method, path, opts);
      if (custom !== undefined)
        return custom instanceof Error ? Promise.reject(custom) : Promise.resolve(custom);
      if (path === '/notifications/unread-count')
        return Promise.resolve({ notifications: 0, messages: 0, byCategory: {} });
      if (path === '/conversations' && method === 'GET')
        return Promise.resolve({ items: [conv()] });
      if (path === '/conversations/c1' && method === 'GET')
        return Promise.resolve({ conversation: conv() });
      if (path === '/conversations/c1/messages' && method === 'GET')
        return Promise.resolve({
          items: [msg(1, 'buyer', 'Hello'), msg(2, 'seller', 'Hi! Available.')],
          hasMore: false,
        });
      if (path === '/conversations/c1/read') return Promise.resolve({ updated: 0 });
      return Promise.resolve({});
    },
  );
}
const renderChat = (route = '/messages/c1') =>
  renderApp(
    <Routes>
      <Route path="/messages" element={<MessagesPage />} />
      <Route path="/messages/:conversationId" element={<MessagesPage />} />
    </Routes>,
    route,
  );

describe('chat', () => {
  it('shows the conversation list, the history with sides, joins the room, and marks it read', async () => {
    chatRoutes();
    renderChat();
    const log = await screen.findByRole('log', { name: 'Messages' });
    expect(await within(log).findByText('Hi! Available.')).toBeTruthy();
    expect(within(log).getByText('Hello')).toBeTruthy();
    const msgs = log.querySelectorAll('.chat-msg');
    expect([...msgs].map((m) => m.getAttribute('data-mine'))).toEqual(['true', 'false']);
    expect(within(log).getByText(/Somchai · Happy Farm/)).toBeTruthy(); // seller-side names are shown with the farm
    expect(screen.getByRole('navigation', { name: 'Conversations' }).textContent).toContain(
      'Swamp buffalo',
    );
    await waitFor(() => expect(fake.client.join).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(calls('POST', /c1\/read$/)).toHaveLength(1));
  });

  it('sends with a clientId, shows it as pending, then replaces it with the stored message', async () => {
    let resolveSend: (v: unknown) => void = () => undefined;
    chatRoutes((m, p) =>
      m === 'POST' && p === '/conversations/c1/messages'
        ? new Promise((r) => (resolveSend = r))
        : undefined,
    );
    renderChat();
    await screen.findByText('Hi! Available.');
    await userEvent.type(screen.getByLabelText('Write a message'), 'Can I visit on Sunday?{Enter}');
    expect(await screen.findByText('Sending…')).toBeTruthy();
    const sent = calls('POST', /c1\/messages$/)[0]![2].body;
    expect(sent.body).toBe('Can I visit on Sunday?');
    expect(sent.clientId).toMatch(/\S{8,}/);
    expect((screen.getByLabelText('Write a message') as HTMLTextAreaElement).value).toBe('');
    await act(async () => resolveSend({ message: msg(3, 'buyer', 'Can I visit on Sunday?') }));
    await waitFor(() => expect(screen.queryByText('Sending…')).toBeNull());
    expect(screen.getAllByText('Can I visit on Sunday?')).toHaveLength(1);
  });

  it('a failed send says so and Retry reuses the same clientId, so the server cannot duplicate it', async () => {
    let attempt = 0;
    chatRoutes((m, p) => {
      if (m === 'POST' && p === '/conversations/c1/messages')
        return ++attempt === 1
          ? new Error('Network error')
          : { message: msg(3, 'buyer', 'Please call me') };
      return undefined;
    });
    renderChat();
    await screen.findByText('Hi! Available.');
    await userEvent.type(screen.getByLabelText('Write a message'), 'Please call me{Enter}');
    expect(await screen.findByText('Not sent')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Network error');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText('Not sent')).toBeNull());
    const [first, second] = calls('POST', /c1\/messages$/).map((c) => c[2].body);
    expect(second.clientId).toBe(first.clientId);
    expect(screen.getAllByText('Please call me')).toHaveLength(1);
  });

  it('appends live messages once (even if the REST reply also delivers them) and marks them read', async () => {
    chatRoutes();
    renderChat();
    await screen.findByText('Hi! Available.');
    const live = {
      conversationId: 'c1',
      message: {
        id: 'm3',
        conversationId: 'c1',
        seq: 3,
        side: 'seller',
        senderName: 'Somchai',
        body: 'Fresh from the socket',
        createdAt: '2026-06-15T05:05:00.000Z',
      },
    };
    act(() => fake.emit('message:new', live));
    act(() => fake.emit('message:new', live));
    expect(await screen.findAllByText('Fresh from the socket')).toHaveLength(1);
    await waitFor(() => expect(calls('POST', /c1\/read$/).length).toBeGreaterThanOrEqual(2));
    act(() =>
      fake.emit('message:new', {
        ...live,
        conversationId: 'other',
        message: { ...live.message, id: 'x', body: 'wrong conversation' },
      }),
    );
    expect(screen.queryByText('wrong conversation')).toBeNull();
  });

  it('after a reconnect it fetches only what it missed, from the last message it has', async () => {
    chatRoutes((m, p, o) =>
      m === 'GET' && p === '/conversations/c1/messages' && o.query?.after !== undefined
        ? { items: [msg(3, 'seller', 'Sent while you were offline')], hasMore: false }
        : undefined,
    );
    renderChat();
    await screen.findByText('Hi! Available.');
    act(() => fake.resync());
    expect(await screen.findByText('Sent while you were offline')).toBeTruthy();
    expect(
      calls('GET', /c1\/messages$/).find((c) => c[2].query?.after !== undefined)![2].query,
    ).toMatchObject({ after: 2 });
  });

  it('shows read receipts on my messages when the other side reads', async () => {
    chatRoutes();
    renderChat();
    const log = await screen.findByRole('log', { name: 'Messages' });
    await within(log).findByText('Hello');
    expect(log.textContent).toContain('Sent');
    act(() =>
      fake.emit('message:read', { conversationId: 'c1', readerSide: 'seller', upToSeq: 2 }),
    );
    await waitFor(() => expect(log.textContent).toContain('Read'));
  });

  it('a blocked conversation disables sending and explains why without attributing it; the blocker can unblock', async () => {
    chatRoutes((m, p) => {
      if (m === 'GET' && p === '/conversations/c1')
        return { conversation: conv({ blocked: 'unavailable' }) };
      return undefined;
    });
    renderChat();
    expect(await screen.findByText(/cannot be sent in this conversation right now/)).toBeTruthy();
    expect((screen.getByLabelText('Write a message') as HTMLTextAreaElement).disabled).toBe(true);
    cleanup();
    chatRoutes((m, p) => {
      if (m === 'GET' && p === '/conversations/c1')
        return { conversation: conv({ blocked: 'byYou' }) };
      if (m === 'DELETE' && p === '/conversations/c1/block')
        return { conversation: conv({ blocked: null }) };
      return undefined;
    });
    renderChat();
    await screen.findByText(/You blocked this conversation/);
    await userEvent.click(screen.getByRole('button', { name: 'Unblock' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Write a message') as HTMLTextAreaElement).disabled).toBe(
        false,
      ),
    );
  });

  it('reports with a reason and explains what is shared; shows the API error if it is refused', async () => {
    let refuse = true;
    chatRoutes((m, p) =>
      m === 'POST' && p === '/conversations/c1/report'
        ? refuse
          ? new Error('You already have an open report about this conversation')
          : { id: 'r1' }
        : undefined,
    );
    renderChat();
    await screen.findByText('Hi! Available.');
    await userEvent.click(screen.getByRole('button', { name: 'Report' }));
    expect(screen.getByText(/shares the other side’s latest message/)).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'illegal');
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }));
    expect((await screen.findByRole('alert')).textContent).toContain('already have an open report');
    refuse = false;
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByText(/A moderator will review/)).toBeTruthy();
    expect(calls('POST', /report$/).at(-1)![2].body).toEqual({ reason: 'illegal' });
  });

  it('leaves the conversation when access is revoked', async () => {
    chatRoutes();
    renderChat();
    await screen.findByText('Hi! Available.');
    act(() => fake.emit('conversation:update', { conversationId: 'c1', revoked: true }));
    await waitFor(() => expect(screen.queryByRole('log', { name: 'Messages' })).toBeNull());
    expect((await screen.findByRole('alert')).textContent).toContain('no longer have access');
    expect(screen.queryByText('Hi! Available.')).toBeNull(); // nothing of the conversation stays on screen
  });

  it('shows an error when the conversation cannot be loaded', async () => {
    chatRoutes((m, p) =>
      p === '/conversations/c1' ? new Error('Conversation not found') : undefined,
    );
    renderChat();
    expect((await screen.findByRole('alert')).textContent).toContain('Conversation not found');
  });
});

describe('contact seller', () => {
  it('starts a conversation about a listing or a product, then opens it', async () => {
    request.mockImplementation((_m: string, path: string) =>
      Promise.resolve(
        path === '/conversations'
          ? { conversation: { id: 'c9' } }
          : { notifications: 0, messages: 0, byCategory: {} },
      ),
    );
    renderApp(
      <Routes>
        <Route path="/" element={<ContactSellerButton listingId="l1" />} />
        <Route path="/messages/:id" element={<p>thread opened</p>} />
      </Routes>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Message seller' }));
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText('Your message'), 'Is it still available?');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('thread opened')).toBeTruthy();
    expect(calls('POST', /^\/conversations$/)[0]![2].body).toEqual({
      listingId: 'l1',
      message: 'Is it still available?',
    });
  });

  it('shows why it failed (e.g. own farm) and stays on the page', async () => {
    request.mockImplementation((_m: string, path: string) =>
      path === '/conversations'
        ? Promise.reject(new Error('You cannot message your own farm'))
        : Promise.resolve({ notifications: 0, messages: 0, byCategory: {} }),
    );
    renderApp(<ContactSellerButton productId="p1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Message seller' }));
    await userEvent.type(screen.getByLabelText('Your message'), 'hi');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect((await screen.findByRole('alert')).textContent).toContain('own farm');
    expect(calls('POST', /^\/conversations$/)[0]![2].body).toEqual({
      productId: 'p1',
      message: 'hi',
    });
  });
});

describe('admin: message reports', () => {
  const report = {
    id: 'r1',
    status: 'open',
    reason: 'abuse',
    details: 'Rude',
    reporterName: 'Buyer B',
    reportedName: 'Seller S',
    reportedUserId: 'u2',
    evidence: [
      {
        side: 'buyer',
        senderName: 'Buyer B',
        body: 'Hello',
        at: '2026-06-15T05:00:00.000Z',
        reported: false,
      },
      {
        side: 'seller',
        senderName: 'Seller S',
        body: 'Go away',
        at: '2026-06-15T05:01:00.000Z',
        reported: true,
      },
    ],
    resolution: null,
    createdAt: '2026-06-15T05:02:00.000Z',
  };
  it('shows only the evidence, resolves with a decision and note, and drops it from the open list', async () => {
    request.mockImplementation((method: string) => {
      if (method === 'GET') return Promise.resolve({ items: [report] });
      return Promise.resolve({
        report: {
          ...report,
          status: 'actioned',
          resolution: { action: 'warn', note: 'Be kind', at: '2026-06-15T06:00:00.000Z' },
        },
      });
    });
    renderApp(<MessageReportsPage />);
    const card = await screen.findByRole('region', { name: 'Report r1' });
    expect(within(card).getByText(/Go away/)).toBeTruthy();
    expect(within(card).getByText(/← reported/)).toBeTruthy();
    expect(screen.getByText(/Conversations cannot be browsed/)).toBeTruthy();
    await userEvent.selectOptions(within(card).getByLabelText('Decision'), 'warn');
    await userEvent.type(within(card).getByLabelText('Note'), 'Be kind');
    await userEvent.click(within(card).getByRole('button', { name: 'Resolve' }));
    await waitFor(() =>
      expect(calls('POST', /r1\/resolve$/)[0]![2].body).toEqual({
        action: 'warn',
        note: 'Be kind',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Report r1' })).toBeNull());
  });
});

describe('inbox in Thai', () => {
  beforeEach(() => setLocale('th'));

  it('re-words notification templates and categories in Thai, and shows the API wording in English', async () => {
    request.mockImplementation((method: string, path: string) => {
      if (path === '/notifications/unread-count')
        return Promise.resolve({ notifications: 2, messages: 0, byCategory: {} });
      if (path === '/notifications/preferences') return Promise.resolve(prefs);
      if (path === '/notifications' && method === 'GET')
        return Promise.resolve({
          items: [
            note(),
            note({
              id: 'n2',
              type: 'moderation.product_rejected',
              category: 'moderation',
              title: 'Product not approved',
              body: '“Dairy feed” was not approved: Photo is blurry',
              link: '/shop/sell',
            }),
            note({
              id: 'n3',
              type: 'farm.member_added',
              category: 'farm',
              title: 'You were added to a farm',
              body: 'You are now manager of Happy Farm.',
              link: '/farms/f1',
            }),
          ],
          unread: 2,
        });
      return Promise.resolve(prefs);
    });
    renderApp(<NotificationsPage />);
    expect(await screen.findByText('ได้รับการชำระเงินแล้ว')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'การแจ้งเตือน' })).toBeTruthy();
    expect(screen.getByText('เราได้รับการชำระเงินสำหรับคำสั่งซื้อ FP-1 แล้ว')).toBeTruthy();
    expect(screen.getByText('สินค้าไม่ได้รับการอนุมัติ')).toBeTruthy();
    expect(screen.getByText('“Dairy feed” ไม่ได้รับการอนุมัติ: Photo is blurry')).toBeTruthy();
    expect(screen.getByText('ตอนนี้คุณเป็นผู้จัดการของ Happy Farm')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'ทำเครื่องหมายว่าอ่าน “ได้รับการชำระเงินแล้ว” แล้ว' }),
    ).toBeTruthy();
    expect(await screen.findByLabelText(/คำสั่งซื้อและการจัดส่ง/)).toBeTruthy(); // preferences

    act(() => setLocale('en'));
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeTruthy();
    expect(screen.getByText('Payment received')).toBeTruthy();
    expect(screen.getByText('We received your payment for order FP-1.')).toBeTruthy();
    expect(screen.getByText('You are now manager of Happy Farm.')).toBeTruthy();
    expect(screen.getByLabelText(/Orders & shipping/)).toBeTruthy();
  });

  it('shows the chat in Thai, including report reasons', async () => {
    request.mockImplementation((_m: string, path: string) => {
      if (path === '/conversations') return Promise.resolve({ items: [conv()] });
      if (path === '/conversations/c1') return Promise.resolve({ conversation: conv() });
      if (path === '/conversations/c1/messages')
        return Promise.resolve({ items: [msg(1, 'buyer', 'Hello')], hasMore: false });
      return Promise.resolve({ updated: 0, notifications: 0, messages: 0, byCategory: {} });
    });
    renderApp(
      <Routes>
        <Route path="/messages/:conversationId" element={<MessagesPage />} />
      </Routes>,
      '/messages/c1',
    );
    expect(await screen.findByText('เกี่ยวกับ: Swamp buffalo')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'ข้อความ', level: 1 })).toBeTruthy();
    expect(screen.getByText(/คุณ · .* · ส่งแล้ว/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'บล็อก' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'รายงาน' }));
    expect(screen.getByRole('option', { name: 'การทารุณสัตว์' })).toBeTruthy();
    act(() => setLocale('en'));
    expect(screen.getByRole('button', { name: 'Block' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Animal cruelty' })).toBeTruthy();
  });
});
