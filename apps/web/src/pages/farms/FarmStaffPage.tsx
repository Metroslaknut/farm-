import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ASSIGNABLE_FARM_ROLES,
  FARM_INVITATION_STATUSES,
  grantableFarmPermissions,
  type FarmInvitationDTO,
  type FarmMemberSummary,
  type FarmPermission,
  type FarmRole,
} from '@farmplus/shared-types';
import {
  createFarmInvitationSchema,
  fieldErrorsFromDetails,
  fieldErrorsFromZod,
  type FieldErrors,
} from '@farmplus/validation';
import { api } from '../../api';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Modal,
  Select,
  Table,
  TextField,
  Textarea,
  type TableColumn,
  type Tone,
} from '../../components/ui';
import { errorMessage } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { localizeErrors, roleLabel, useFarmFormat, useFarmsT, type FarmsT } from './labels';
import { permissionLabel } from './staffLabels';
import { useFarm } from './useFarmAccess';

type Assignable = (typeof ASSIGNABLE_FARM_ROLES)[number];

export const INVITATION_TONE: Record<FarmInvitationDTO['status'], Tone> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  REVOKED: 'neutral',
  CANCELLED: 'neutral',
};

export function Person({ name, avatarUrl }: { name: string; avatarUrl?: string | undefined }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="ds-row" style={{ gap: 'var(--ds-space-2)', flexWrap: 'nowrap' }}>
      {avatarUrl ? (
        <img className="fd-avatar fd-avatar--sm" src={avatarUrl} alt="" />
      ) : (
        <span className="fd-avatar fd-avatar--sm" aria-hidden="true">
          {initials}
        </span>
      )}
      <span>{name}</span>
    </span>
  );
}

/** Checkboxes for the permissions a role allows (the role is the ceiling; nothing above it is offered). */
function PermissionPicker({
  role,
  value,
  onChange,
}: {
  role: Assignable;
  value: FarmPermission[];
  onChange: (next: FarmPermission[]) => void;
}) {
  const t = useFarmsT();
  const options = grantableFarmPermissions(role);
  return (
    <fieldset className="ds-field" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="ds-field__label">{t('staff.permissions')}</legend>
      <p className="ds-field__hint">{t('staff.permissionsHint')}</p>
      <div className="ds-grid ds-grid--2">
        {options.map((p) => (
          <Checkbox
            key={p}
            label={permissionLabel(t, p)}
            checked={value.includes(p)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, p] : value.filter((x) => x !== p))
            }
          />
        ))}
      </div>
    </fieldset>
  );
}

const permsSummary = (t: FarmsT, m: FarmMemberSummary) =>
  m.role === 'owner'
    ? t('staff.allPermissions')
    : m.customPermissions
      ? t('staff.customCount', { n: m.permissions.length })
      : t('staff.roleDefaults');

/** `/farms/:farmId/staff`: members with their permissions, invitations and join requests (owner manages). */
export default function FarmStaffPage() {
  const t = useFarmsT();
  const fmt = useFarmFormat();
  const { farmId = '' } = useParams();
  const { farm, can } = useFarm(farmId);
  const manage = can('members.manage') && farm?.status === 'active';
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);
  const members = useAsync(
    (signal) =>
      api.request<{ members: FarmMemberSummary[] }>('GET', `/farms/${farmId}/members`, { signal }),
    [farmId, version],
  );
  const [status, setStatus] = useState<string>('PENDING');
  const invitations = useAsync(
    async (signal) =>
      can('members.manage')
        ? (
            await api.request<{ invitations: FarmInvitationDTO[] }>(
              'GET',
              `/farms/${farmId}/invitations`,
              { query: status ? { status } : {}, signal },
            )
          ).invitations
        : [],
    [farmId, version, status, farm?.id],
  );
  const [editing, setEditing] = useState<FarmMemberSummary | null>(null);
  const [revoking, setRevoking] = useState<FarmMemberSummary | null>(null);
  const [approving, setApproving] = useState<FarmInvitationDTO | null>(null);
  const [notice, setNotice] = useState<string>();
  const [actionError, setActionError] = useState<string>();

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setActionError(undefined);
    try {
      await fn();
      setNotice(done);
      refresh();
      return true;
    } catch (e) {
      setActionError(errorMessage(e));
      return false;
    }
  };

  const memberColumns: TableColumn<FarmMemberSummary>[] = [
    {
      key: 'name',
      header: t('staff.col.name'),
      cell: (m) => (
        <span>
          <Person name={m.displayName} avatarUrl={m.avatarUrl} />
          {m.email && <small className="ds-field__hint"> {m.email}</small>}
        </span>
      ),
    },
    { key: 'role', header: t('staff.col.role'), cell: (m) => roleLabel(t, m.role) },
    {
      key: 'invited',
      header: t('staff.col.invitedAt'),
      cell: (m) => fmt.date(m.invitedAt ?? m.joinedAt),
    },
    {
      key: 'approved',
      header: t('staff.col.approvedAt'),
      cell: (m) => fmt.date(m.approvedAt ?? m.joinedAt),
    },
    {
      key: 'status',
      header: t('staff.col.status'),
      cell: () => <Badge tone="success">{t('inv.status.APPROVED')}</Badge>,
    },
    { key: 'perms', header: t('staff.col.permissions'), cell: (m) => permsSummary(t, m) },
    {
      key: 'actions',
      header: t('common.actions'),
      cell: (m) =>
        manage && m.role !== 'owner' ? (
          <span className="ds-row" data-tour="staff-member-actions">
            <Button size="sm" onClick={() => setEditing(m)}>
              {t('staff.editPermissions')}
            </Button>
            <Button size="sm" variant="danger" onClick={() => setRevoking(m)}>
              {t('staff.revoke')}
            </Button>
          </span>
        ) : (
          '—'
        ),
    },
  ];

  const invitationColumns: TableColumn<FarmInvitationDTO>[] = [
    {
      key: 'who',
      header: t('staff.col.name'),
      cell: (i) => (
        <span>
          <Person name={i.user.displayName} avatarUrl={i.user.avatarUrl} />
          {i.user.email && <small className="ds-field__hint"> {i.user.email}</small>}
        </span>
      ),
    },
    {
      key: 'dir',
      header: t('inv.col.kind'),
      cell: (i) => t(i.direction === 'invite' ? 'inv.kind.invite' : 'inv.kind.request'),
    },
    {
      key: 'role',
      header: t('staff.col.role'),
      cell: (i) => (i.role ? roleLabel(t, i.role) : '—'),
    },
    { key: 'at', header: t('staff.col.invitedAt'), cell: (i) => fmt.date(i.createdAt) },
    {
      key: 'status',
      header: t('staff.col.status'),
      cell: (i) => <Badge tone={INVITATION_TONE[i.status]}>{t(`inv.status.${i.status}`)}</Badge>,
    },
    { key: 'msg', header: t('inv.col.message'), cell: (i) => i.message ?? '—' },
    {
      key: 'actions',
      header: t('common.actions'),
      cell: (i) =>
        !manage || i.status !== 'PENDING' ? (
          '—'
        ) : i.direction === 'invite' ? (
          <Button
            size="sm"
            onClick={() =>
              void act(
                () => api.request('POST', `/farms/${farmId}/invitations/${i.id}/cancel`),
                t('inv.cancelled'),
              )
            }
          >
            {t('inv.cancel')}
          </Button>
        ) : (
          <span className="ds-row" data-tour="staff-request-actions">
            <Button size="sm" variant="primary" onClick={() => setApproving(i)}>
              {t('inv.approve')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() =>
                void act(
                  () => api.request('POST', `/farms/${farmId}/invitations/${i.id}/reject`),
                  t('inv.rejected'),
                )
              }
            >
              {t('inv.reject')}
            </Button>
          </span>
        ),
    },
  ];

  const joinLink = `${window.location.origin}/farms/invitations?join=${farmId}`;

  return (
    <>
      <p>
        <Link to={`/farms/${farmId}`}>← {farm?.name ?? t('common.farm')}</Link>
      </p>
      <h1>{t('staff.title')}</h1>
      <p className="ds-field__hint">{t('staff.intro')}</p>
      {notice && (
        <Alert tone="success" style={{ marginBottom: 'var(--ds-space-3)' }}>
          {notice}
        </Alert>
      )}
      {actionError && (
        <Alert tone="danger" style={{ marginBottom: 'var(--ds-space-3)' }}>
          {actionError}
        </Alert>
      )}
      {farm?.status === 'archived' && <Alert tone="warning">{t('common.farmArchived')}</Alert>}

      {members.error && (
        <Alert tone="danger">
          {members.error}{' '}
          <button type="button" onClick={members.reload}>
            {t('common.tryAgain')}
          </button>
        </Alert>
      )}
      {members.loading && !members.data && <p role="status">{t('common.loading')}</p>}
      {members.data && (
        <Table
          caption={t('staff.members')}
          columns={memberColumns}
          rows={members.data.members}
          rowKey={(m) => m.id}
          emptyMessage={t('staff.empty')}
        />
      )}

      {manage && (
        <div className="ds-grid ds-grid--2" style={{ marginTop: 'var(--ds-space-4)' }}>
          <InviteForm
            farmId={farmId}
            onSent={() => {
              setNotice(t('inv.sent'));
              setStatus('PENDING');
              refresh();
            }}
          />
          <Card title={t('staff.joinLinkTitle')} headingLevel={2} data-tour="staff-join-link">
            <p className="ds-field__hint">{t('staff.joinLinkHint')}</p>
            <TextField label={t('staff.joinLink')} value={joinLink} readOnly />
            <Button
              onClick={() => {
                void navigator.clipboard?.writeText(joinLink);
                setNotice(t('staff.joinLinkCopied'));
              }}
            >
              {t('staff.copy')}
            </Button>
          </Card>
        </div>
      )}

      {can('members.manage') && (
        <section style={{ marginTop: 'var(--ds-space-4)' }} data-tour="staff-invitations">
          <div className="ds-row" style={{ justifyContent: 'space-between', alignItems: 'end' }}>
            <h2>{t('staff.invitations')}</h2>
            <Select
              label={t('staff.col.status')}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">{t('common.all')}</option>
              {FARM_INVITATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`inv.status.${s}`)}
                </option>
              ))}
            </Select>
          </div>
          {invitations.error && <Alert tone="danger">{invitations.error}</Alert>}
          {invitations.loading && !invitations.data && <p role="status">{t('common.loading')}</p>}
          {invitations.data && (
            <Table
              caption={t('staff.invitations')}
              columns={invitationColumns}
              rows={invitations.data}
              rowKey={(i) => i.id}
              emptyMessage={t('inv.empty')}
            />
          )}
        </section>
      )}

      {editing && (
        <EditMemberModal
          farmId={farmId}
          member={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setNotice(t('staff.saved'));
            refresh();
          }}
        />
      )}
      <Modal
        open={Boolean(revoking)}
        onClose={() => setRevoking(null)}
        title={t('staff.revokeTitle')}
        footer={
          <div className="ds-row">
            <Button
              variant="danger"
              onClick={() => {
                const m = revoking!;
                void act(
                  () => api.request('DELETE', `/farms/${farmId}/members/${m.id}`),
                  t('staff.revoked', { name: m.displayName }),
                ).then(() => setRevoking(null));
              }}
            >
              {t('staff.revoke')}
            </Button>
            <Button onClick={() => setRevoking(null)}>{t('common.cancel')}</Button>
          </div>
        }
      >
        <p>{revoking && t('staff.revokeConfirm', { name: revoking.displayName })}</p>
      </Modal>
      {approving && (
        <ApproveModal
          farmId={farmId}
          invitation={approving}
          onClose={() => setApproving(null)}
          onDone={() => {
            setApproving(null);
            setNotice(t('inv.approved'));
            refresh();
          }}
        />
      )}
    </>
  );
}

function InviteForm({ farmId, onSent }: { farmId: string; onSent: () => void }) {
  const t = useFarmsT();
  const [by, setBy] = useState<'email' | 'phone'>('email');
  const [contact, setContact] = useState('');
  const [role, setRole] = useState<Assignable>('manager');
  const [custom, setCustom] = useState(false);
  const [permissions, setPermissions] = useState<FarmPermission[]>(
    grantableFarmPermissions('manager'),
  );
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      [by]: contact.trim(),
      role,
      ...(custom ? { permissions } : {}),
      ...(message.trim() ? { message: message.trim() } : {}),
    };
    const parsed = createFarmInvitationSchema.safeParse(body);
    if (!parsed.success) return setErrors(localizeErrors(fieldErrorsFromZod(parsed.error)));
    setBusy(true);
    setErrors({});
    try {
      await api.request('POST', `/farms/${farmId}/invitations`, { body: parsed.data });
      setContact('');
      setMessage('');
      onSent();
    } catch (err) {
      const mapped = fieldErrorsFromDetails(
        (err as { details?: { path: string; message: string }[] }).details,
      );
      setErrors(Object.keys(mapped).length ? localizeErrors(mapped) : { _form: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('inv.inviteTitle')} headingLevel={2} data-tour="staff-invite">
      <form onSubmit={submit} noValidate>
        <p className="ds-field__hint">{t('inv.inviteHint')}</p>
        {errors['_form'] && <Alert tone="danger">{errors['_form']}</Alert>}
        <Select
          label={t('inv.findBy')}
          value={by}
          onChange={(e) => setBy(e.target.value as 'email' | 'phone')}
        >
          <option value="email">{t('inv.byEmail')}</option>
          <option value="phone">{t('inv.byPhone')}</option>
        </Select>
        <TextField
          label={by === 'email' ? t('inv.email') : t('inv.phone')}
          hint={by === 'phone' ? t('inv.phoneHint') : undefined}
          type={by === 'email' ? 'email' : 'tel'}
          required
          value={contact}
          error={errors[by]}
          onChange={(e) => setContact(e.target.value)}
        />
        <Select
          label={t('staff.col.role')}
          data-tour="staff-invite-role"
          value={role}
          onChange={(e) => {
            const next = e.target.value as Assignable;
            setRole(next);
            setPermissions(grantableFarmPermissions(next));
          }}
        >
          {ASSIGNABLE_FARM_ROLES.map((r) => (
            <option key={r} value={r}>
              {roleLabel(t, r as FarmRole)}
            </option>
          ))}
        </Select>
        <Checkbox
          label={t('staff.customise')}
          data-tour="staff-invite-permissions"
          checked={custom}
          onChange={(e) => setCustom(e.target.checked)}
        />
        {custom && <PermissionPicker role={role} value={permissions} onChange={setPermissions} />}
        <Textarea
          label={t('inv.message')}
          rows={2}
          value={message}
          error={errors['message']}
          onChange={(e) => setMessage(e.target.value)}
        />
        <Button type="submit" variant="primary" loading={busy}>
          {t('inv.send')}
        </Button>
      </form>
    </Card>
  );
}

function EditMemberModal({
  farmId,
  member,
  onClose,
  onSaved,
}: {
  farmId: string;
  member: FarmMemberSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useFarmsT();
  const startRole = member.role as Assignable;
  const [role, setRole] = useState<Assignable>(startRole);
  const [permissions, setPermissions] = useState<FarmPermission[]>(
    member.permissions.filter((p) => p !== 'farm.read'),
  );
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const save = async (reset: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      const defaults = grantableFarmPermissions(role);
      const isDefault =
        reset ||
        (permissions.length === defaults.length && defaults.every((p) => permissions.includes(p)));
      const putPermissions = (body: FarmPermission[] | null) =>
        api.request('PUT', `/farms/${farmId}/members/${member.id}/permissions`, {
          body: { permissions: body },
        });
      if (role !== startRole) {
        // A role change resets the member to the new role's defaults on the server.
        await api.request('PATCH', `/farms/${farmId}/members/${member.id}`, { body: { role } });
        if (!isDefault) await putPermissions(permissions);
      } else if (isDefault ? member.customPermissions : true) {
        await putPermissions(isDefault ? null : permissions);
      }
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('staff.editTitle', { name: member.displayName })}
      footer={
        <div className="ds-row">
          <Button variant="primary" loading={busy} onClick={() => void save(false)}>
            {t('staff.save')}
          </Button>
          <Button disabled={busy} onClick={() => void save(true)}>
            {t('staff.resetDefaults')}
          </Button>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
        </div>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <Select
        label={t('staff.col.role')}
        value={role}
        onChange={(e) => {
          const next = e.target.value as Assignable;
          setRole(next);
          setPermissions(grantableFarmPermissions(next));
        }}
      >
        {ASSIGNABLE_FARM_ROLES.map((r) => (
          <option key={r} value={r}>
            {roleLabel(t, r as FarmRole)}
          </option>
        ))}
      </Select>
      <PermissionPicker role={role} value={permissions} onChange={setPermissions} />
    </Modal>
  );
}

function ApproveModal({
  farmId,
  invitation,
  onClose,
  onDone,
}: {
  farmId: string;
  invitation: FarmInvitationDTO;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useFarmsT();
  const [role, setRole] = useState<Assignable>('manager');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const approve = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.request('POST', `/farms/${farmId}/invitations/${invitation.id}/approve`, {
        body: { role },
      });
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t('inv.approveTitle', { name: invitation.user.displayName })}
      footer={
        <div className="ds-row">
          <Button variant="primary" loading={busy} onClick={() => void approve()}>
            {t('inv.approve')}
          </Button>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
        </div>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {invitation.message && <p>“{invitation.message}”</p>}
      <Select
        label={t('staff.col.role')}
        value={role}
        onChange={(e) => setRole(e.target.value as Assignable)}
      >
        {ASSIGNABLE_FARM_ROLES.map((r) => (
          <option key={r} value={r}>
            {roleLabel(t, r as FarmRole)}
          </option>
        ))}
      </Select>
      <p className="ds-field__hint">{t('inv.approveHint')}</p>
    </Modal>
  );
}
