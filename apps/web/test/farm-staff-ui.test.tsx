import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// All pages talk to the API only through `api.request` — replace it with fixtures.
const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request }, apiFileUrl: (u: string) => u }));

import FarmStaffPage from '../src/pages/farms/FarmStaffPage';
import MyInvitationsPage from '../src/pages/farms/MyInvitationsPage';
import PedigreePage from '../src/pages/farms/records/PedigreePage';
import { RecordForm } from '../src/pages/farms/records/RecordForm';
import { RecordHistoryPanel } from '../src/pages/farms/records/RecordHistoryPanel';
import { KINDS } from '../src/pages/farms/records/recordConfigs';
import { setLocale } from '../src/i18n';
import { forgetRecent } from '../src/lib/shared';

const FARM = '0123456789abcdef01234567';
const CHICKEN = '444444444444444444444444';
type Handler = (opts?: { query?: Record<string, unknown>; body?: unknown }) => unknown;

function mockApi(handlers: Record<string, Handler>) {
  request.mockImplementation(
    async (
      method: string,
      path: string,
      opts?: { query?: Record<string, unknown>; body?: unknown },
    ) => {
      const handler = handlers[`${method} ${path}`];
      if (!handler) throw new Error(`unexpected request ${method} ${path}`);
      return handler(opts);
    },
  );
}
const renderAt = (path: string, route: string, element: React.ReactNode) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={element} />
        <Route path="*" element={<p>navigated: elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  );
const farm = (permissions: string[]) => ({
  farm: {
    id: FARM,
    name: 'Rooster Farm',
    status: 'active',
    location: {},
    contact: {},
    myRole: 'owner',
    createdAt: '2026-01-01T00:00:00Z',
    access: { via: 'member', permissions },
    stats: { animalsTotal: 0, animalsActive: 0, byStatus: {} },
  },
});
const OWNER = ['farm.read', 'members.read', 'members.manage', 'farm.update'];
const members = [
  {
    id: 'm0',
    userId: 'u0',
    displayName: 'Owner Person',
    email: 'owner@example.test',
    role: 'owner',
    joinedAt: '2026-01-01T00:00:00Z',
    permissions: ['farm.read'],
    customPermissions: false,
  },
  {
    id: 'm1',
    userId: 'u1',
    displayName: 'Manee Manager',
    email: 'manee@example.test',
    role: 'manager',
    joinedAt: '2026-02-01T00:00:00Z',
    invitedAt: '2026-01-30T00:00:00Z',
    approvedAt: '2026-02-01T00:00:00Z',
    permissions: ['farm.read', 'animals.read', 'breeding.read'],
    customPermissions: true,
  },
];

beforeEach(() => {
  request.mockReset();
  forgetRecent();
  setLocale('en');
});

describe('FarmStaffPage (owner)', () => {
  it('lists staff with dates, status and permissions; invites by e-mail; edits and revokes', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    const record =
      (method: string, path: string, reply: unknown): Handler =>
      (opts) => {
        calls.push({ method, path, body: opts?.body });
        return reply;
      };
    mockApi({
      [`GET /farms/${FARM}`]: () => farm(OWNER),
      [`GET /farms/${FARM}/members`]: () => ({ members }),
      [`GET /farms/${FARM}/invitations`]: () => ({
        invitations: [
          {
            id: 'r1',
            direction: 'request',
            status: 'PENDING',
            farm: { id: FARM, name: 'Rooster Farm' },
            user: { id: 'u9', displayName: 'Somsak Asker' },
            permissions: null,
            message: 'I live nearby',
            createdAt: '2026-03-01T00:00:00Z',
          },
        ],
      }),
      [`POST /farms/${FARM}/invitations`]: record('POST', 'invite', { invitation: {} }),
      [`PUT /farms/${FARM}/members/m1/permissions`]: record('PUT', 'perms', { member: {} }),
      [`DELETE /farms/${FARM}/members/m1`]: record('DELETE', 'revoke', undefined),
      [`POST /farms/${FARM}/invitations/r1/approve`]: record('POST', 'approve', {
        invitation: {},
      }),
    });
    renderAt(`/farms/${FARM}/staff`, '/farms/:farmId/staff', <FarmStaffPage />);
    const table = within(await screen.findByRole('table', { name: 'Farm staff' }));
    expect(table.getAllByText('Manee Manager').length).toBeGreaterThan(0);
    expect(table.getAllByText('Custom (3 permissions)').length).toBeGreaterThan(0);
    expect(table.getAllByText('All (owner)').length).toBeGreaterThan(0);
    // pending join request with approve / decline
    const pending = within(
      await screen.findByRole('table', { name: 'Invitations and join requests' }),
    );
    // The table can render before its rows arrive (slow CI): wait for the row, do not assume it.
    expect((await pending.findAllByText('Join request')).length).toBeGreaterThan(0);

    // Invite by e-mail as a worker
    fireEvent.change(screen.getByLabelText(/Their e-mail/), {
      target: { value: 'new@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Role', { selector: 'select' }), {
      target: { value: 'worker' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    await waitFor(() => expect(calls.some((c) => c.path === 'invite')).toBe(true));
    expect(calls.find((c) => c.path === 'invite')!.body).toEqual({
      email: 'new@example.test',
      role: 'worker',
    });
    expect(await screen.findByText(/Invitation sent/)).toBeTruthy();

    // Edit permissions: untick "View breeding records"
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit permissions' })[0]!);
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.click(dialog.getByLabelText('View breeding records'));
    fireEvent.click(dialog.getByRole('button', { name: 'Save permissions' }));
    await waitFor(() => expect(calls.some((c) => c.path === 'perms')).toBe(true));
    expect(calls.find((c) => c.path === 'perms')!.body).toEqual({
      permissions: ['animals.read'],
    });

    // Revoke
    fireEvent.click(screen.getAllByRole('button', { name: 'Revoke access' })[0]!);
    const confirm = within(await screen.findByRole('dialog'));
    fireEvent.click(confirm.getByRole('button', { name: 'Revoke access' }));
    await waitFor(() => expect(calls.some((c) => c.path === 'revoke')).toBe(true));

    // Approve the join request as a viewer
    fireEvent.click(screen.getAllByRole('button', { name: 'Approve' })[0]!);
    const approve = within(await screen.findByRole('dialog'));
    fireEvent.change(approve.getByLabelText('Role'), { target: { value: 'viewer' } });
    fireEvent.click(approve.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(calls.some((c) => c.path === 'approve')).toBe(true));
    expect(calls.find((c) => c.path === 'approve')!.body).toEqual({ role: 'viewer' });
  });

  it('a manager sees the staff list read-only, without invitations or actions', async () => {
    mockApi({
      [`GET /farms/${FARM}`]: () => farm(['farm.read', 'members.read']),
      [`GET /farms/${FARM}/members`]: () => ({
        members: members.map((m) => ({ ...m, email: undefined })),
      }),
    });
    renderAt(`/farms/${FARM}/staff`, '/farms/:farmId/staff', <FarmStaffPage />);
    expect(await screen.findByRole('table', { name: 'Farm staff' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit permissions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send invitation' })).toBeNull();
    expect(screen.queryByRole('table', { name: 'Invitations and join requests' })).toBeNull();
    expect(request.mock.calls.some((c) => String(c[1]).endsWith('/invitations'))).toBe(false);
  });
});

describe('MyInvitationsPage', () => {
  it('accepts an invitation and opens the farm; a join link pre-fills the request form', async () => {
    const accepted = vi.fn(() => ({ invitation: {} }));
    const requested = vi.fn((_opts?: { body?: unknown }) => ({ invitation: {} }));
    mockApi({
      'GET /farm-invitations': () => ({
        invitations: [
          {
            id: 'i1',
            direction: 'invite',
            status: 'PENDING',
            farm: { id: FARM, name: 'Rooster Farm' },
            user: { id: 'me', displayName: 'Me' },
            role: 'manager',
            permissions: null,
            createdAt: '2026-03-01T00:00:00Z',
          },
        ],
      }),
      'POST /farm-invitations/i1/accept': accepted,
      'POST /farm-invitations/requests': (opts) => requested(opts),
    });
    renderAt(
      `/farms/invitations?join=https://farmplus.example/farms/invitations?join=${FARM}`,
      '/farms/invitations',
      <MyInvitationsPage />,
    );
    expect(await screen.findByText(/Invited as Manager/)).toBeTruthy();
    expect((screen.getByLabelText(/Farm link or id/) as HTMLInputElement).value).toContain(FARM);
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(requested).toHaveBeenCalled());
    expect(requested.mock.calls[0]![0]!.body).toEqual({ farmId: FARM });

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByText('navigated: elsewhere')).toBeTruthy();
    expect(accepted).toHaveBeenCalled();
  });

  it('shows Thai texts', async () => {
    setLocale('th');
    mockApi({ 'GET /farm-invitations': () => ({ invitations: [] }) });
    renderAt('/farms/invitations', '/farms/invitations', <MyInvitationsPage />);
    expect(await screen.findByText('ไม่มีคำเชิญที่รอการตอบรับ')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'คำเชิญของฉัน' })).toBeTruthy();
  });
});

describe('PedigreePage', () => {
  it('labels generations from recorded parents (F0, F1, unknown) and links the breeding history', async () => {
    const bird = (id: string, f: number | null, extra: object = {}) => ({
      id,
      animalCode: id.toUpperCase(),
      sex: 'male',
      currentStatus: 'active',
      archived: false,
      filialGeneration: f,
      ...extra,
    });
    mockApi({
      [`GET /farms/${FARM}/animals/c1/lineage`]: () => ({
        animal: { id: 'c1', animalCode: 'C1' },
        sire: { id: 's', animalCode: 'S' },
        dam: { id: 'd', animalCode: 'D' },
        offspring: [],
        pedigree: {
          animal: bird('c1', 1, {
            breed: 'cross_burmese_thai',
            breedName: 'Burmese + Thai',
            breedNameTh: 'พม่า + ไทย',
            breedGroup: { key: 'crossbred', name: 'Crossbreeds' },
          }),
          sire: { animal: bird('s', 0, { breedName: 'Burmese Ma Lo' }) },
          dam: { animal: bird('d', null) },
        },
        generations: 3,
        generation: 1,
        siblings: [{ ...bird('c2', 1), relation: 'full' }],
      }),
    });
    renderAt(
      `/farms/${FARM}/animals/c1/lineage`,
      '/farms/:farmId/animals/:animalId/lineage',
      <PedigreePage />,
    );
    expect((await screen.findAllByText('F1')).length).toBeGreaterThan(0);
    expect(screen.getByText('Parent stock (F0)')).toBeTruthy();
    expect(screen.getByText('Generation unknown')).toBeTruthy();
    expect(screen.getAllByText(/Burmese \+ Thai/).length).toBeGreaterThan(0);
    expect(screen.getByText('Crossbreeds')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Breeding history' }).getAttribute('href')).toBe(
      `/farms/${FARM}/breeding?animalId=c1`,
    );
  });
});

describe('breeding form', () => {
  it('shows the parents’ breeds and the suggested offspring breed at once; clutch fields for egg-layers', async () => {
    const types = {
      animalTypes: [
        {
          id: CHICKEN,
          key: 'chicken',
          name: 'Chicken',
          status: 'active',
          reproduction: 'egg',
          rearingTypes: [],
          breedGroups: [
            { key: 'thai', name: 'Thai', active: true },
            { key: 'burmese', name: 'Burmese', active: true },
            { key: 'crossbred', name: 'Crossbreeds', active: true },
          ],
          breeds: [
            { key: 'lueang', name: 'Lueang Hang Khao', groupKey: 'thai', active: true },
            { key: 'malo', name: 'Burmese Ma Lo', groupKey: 'burmese', active: true },
            {
              key: 'bt',
              name: 'Burmese + Thai',
              groupKey: 'crossbred',
              composition: ['burmese', 'thai'],
              active: true,
            },
          ],
        },
      ],
    };
    const a = (id: string, sex: string, breed: string, breedName: string, group: string) => ({
      id,
      breedGroup: { key: group.toLowerCase(), name: group },
      farmId: FARM,
      animalCode: id.toUpperCase(),
      animalType: { id: CHICKEN, key: 'chicken', name: 'Chicken' },
      breed,
      breedName,
      sex,
      currentStatus: 'active',
      archived: false,
      createdAt: '2026-01-01T00:00:00Z',
    });
    mockApi({
      '/animal-types': () => types,
      'GET /animal-types': () => types,
      [`GET /farms/${FARM}/animals`]: () => ({
        items: [
          a('hen1', 'female', 'lueang', 'Lueang Hang Khao', 'Thai'),
          a('cock1', 'male', 'malo', 'Burmese Ma Lo', 'Burmese'),
        ],
        page: 1,
        pageSize: 100,
        total: 2,
      }),
    });
    render(
      <MemoryRouter>
        <RecordForm config={KINDS.breeding} farmId={FARM} onDone={() => {}} onCancel={() => {}} />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getAllByRole('option', { name: /HEN1 · Lueang Hang Khao/ }).length).toBe(1),
    );
    expect(screen.queryByText('Eggs and hatching')).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Dam/), { target: { value: 'hen1' } });
    fireEvent.change(screen.getByLabelText(/Sire on this farm/), { target: { value: 'cock1' } });
    const preview = within(await screen.findByRole('status'));
    expect(preview.getByText(/Lueang Hang Khao \(Thai\)/)).toBeTruthy();
    expect(preview.getByText(/Burmese Ma Lo \(Burmese\)/)).toBeTruthy();
    expect(preview.getByText('Burmese + Thai')).toBeTruthy();
    expect(screen.getByText('Eggs and hatching')).toBeTruthy();
  });
});

describe('breeding photos', () => {
  const record = (attachments: object[]) => ({ id: 'r1', attachments, revision: 1 }) as never;
  it('offers device upload only where allowed, and shows uploaded photos as thumbnails', () => {
    const photo = {
      id: 'p1',
      kind: 'photo',
      url: '/api/v1/animal-photos/abc',
      mimeType: 'image/png',
      addedBy: { id: 'u1', displayName: 'Worker' },
      addedAt: '2026-11-21T00:00:00Z',
    };
    const { unmount } = render(
      <RecordHistoryPanel
        basePath={`/farms/${FARM}/breeding`}
        record={record([photo])}
        history={[]}
        canWrite
        canCorrect
        onChanged={() => {}}
        allowUpload
      />,
    );
    expect(screen.getByRole('heading', { name: 'Upload photos' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload photos (0)' })).toBeTruthy();
    expect(screen.getByRole('img').getAttribute('src')).toBe('/api/v1/animal-photos/abc');
    unmount();
    render(
      <RecordHistoryPanel
        basePath={`/farms/${FARM}/health`}
        record={record([])}
        history={[]}
        canWrite
        canCorrect
        onChanged={() => {}}
      />,
    );
    expect(screen.queryByRole('heading', { name: 'Upload photos' })).toBeNull();
  });
});
