import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { FarmInvitationDTO } from '@farmplus/shared-types';
import { api } from '../../api';
import { Alert, Badge, Button, Card, Table, TextField, Textarea } from '../../components/ui';
import { errorMessage } from '../../lib/format';
import { forgetRecent } from '../../lib/shared';
import { useAsync } from '../../lib/useAsync';
import { INVITATION_TONE } from './FarmStaffPage';
import { roleLabel, useFarmFormat, useFarmsT } from './labels';

/** A farm id, or a farm link containing one (e.g. the join link an owner shared). */
const farmIdFrom = (text: string): string | undefined => text.match(/[0-9a-f]{24}/i)?.[0];

/** `/farms/invitations`: invitations I received (accept / decline) and join requests I sent. */
export default function MyInvitationsPage() {
  const t = useFarmsT();
  const fmt = useFarmFormat();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const { data, loading, error, reload } = useAsync(
    (signal) =>
      api.request<{ invitations: FarmInvitationDTO[] }>('GET', '/farm-invitations', { signal }),
    [version],
  );
  const [farmLink, setFarmLink] = useState(search.get('join') ?? '');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const act = async (inv: FarmInvitationDTO, action: 'accept' | 'decline' | 'cancel') => {
    setActionError(undefined);
    try {
      await api.request('POST', `/farm-invitations/${inv.id}/${action}`);
      if (action === 'accept') {
        // The farm list and setup state changed: drop the cached copies, then open the farm.
        forgetRecent();
        navigate(`/farms/${inv.farm.id}`);
        return;
      }
      setNotice(t(action === 'decline' ? 'inv.declined' : 'inv.cancelled'));
      setVersion((v) => v + 1);
    } catch (e) {
      setActionError(errorMessage(e));
    }
  };

  const requestJoin = async (e: FormEvent) => {
    e.preventDefault();
    const farmId = farmIdFrom(farmLink);
    if (!farmId) return setActionError(t('inv.farmLinkInvalid'));
    setBusy(true);
    setActionError(undefined);
    try {
      await api.request('POST', '/farm-invitations/requests', {
        body: { farmId, ...(message.trim() ? { message: message.trim() } : {}) },
      });
      setFarmLink('');
      setMessage('');
      setNotice(t('inv.requestSent'));
      setVersion((v) => v + 1);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const all = data?.invitations ?? [];
  const received = all.filter((i) => i.direction === 'invite' && i.status === 'PENDING');
  const others = all.filter((i) => !(i.direction === 'invite' && i.status === 'PENDING'));

  return (
    <>
      <h1>{t('inv.mineTitle')}</h1>
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
      {error && (
        <Alert tone="danger">
          {error}{' '}
          <button type="button" onClick={reload}>
            {t('common.tryAgain')}
          </button>
        </Alert>
      )}
      {loading && !data && <p role="status">{t('common.loading')}</p>}

      {data && (
        <section aria-label={t('inv.received')}>
          <h2>{t('inv.received')}</h2>
          {received.length === 0 && <p className="ds-field__hint">{t('inv.noneReceived')}</p>}
          <div className="ds-grid ds-grid--2">
            {received.map((i) => (
              <Card key={i.id} title={i.farm.name} headingLevel={3}>
                <p>
                  {t('inv.invitedAs', { role: i.role ? roleLabel(t, i.role) : '—' })} ·{' '}
                  {fmt.date(i.createdAt)}
                </p>
                {i.message && <p>“{i.message}”</p>}
                <div className="ds-row">
                  <Button variant="primary" onClick={() => void act(i, 'accept')}>
                    {t('inv.accept')}
                  </Button>
                  <Button variant="danger" onClick={() => void act(i, 'decline')}>
                    {t('inv.decline')}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      <Card title={t('inv.joinTitle')} headingLevel={2} style={{ margin: 'var(--ds-space-4) 0' }}>
        <form onSubmit={requestJoin} noValidate>
          <p className="ds-field__hint">{t('inv.joinHint')}</p>
          <TextField
            label={t('inv.farmLink')}
            required
            value={farmLink}
            onChange={(e) => setFarmLink(e.target.value)}
          />
          <Textarea
            label={t('inv.message')}
            rows={2}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <Button type="submit" variant="primary" loading={busy}>
            {t('inv.sendRequest')}
          </Button>
        </form>
      </Card>

      {data && (
        <Table
          caption={t('inv.history')}
          rows={others}
          rowKey={(i) => i.id}
          emptyMessage={t('inv.empty')}
          columns={[
            {
              key: 'farm',
              header: t('common.farm'),
              cell: (i) =>
                i.status === 'APPROVED' ? (
                  <Link to={`/farms/${i.farm.id}`}>{i.farm.name}</Link>
                ) : (
                  i.farm.name
                ),
            },
            {
              key: 'kind',
              header: t('inv.col.kind'),
              cell: (i) => t(i.direction === 'invite' ? 'inv.kind.invite' : 'inv.kind.myRequest'),
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
              cell: (i) => (
                <Badge tone={INVITATION_TONE[i.status]}>{t(`inv.status.${i.status}`)}</Badge>
              ),
            },
            {
              key: 'actions',
              header: t('common.actions'),
              cell: (i) =>
                i.direction === 'request' && i.status === 'PENDING' ? (
                  <Button size="sm" onClick={() => void act(i, 'cancel')}>
                    {t('inv.cancelRequest')}
                  </Button>
                ) : (
                  '—'
                ),
            },
          ]}
        />
      )}
    </>
  );
}
