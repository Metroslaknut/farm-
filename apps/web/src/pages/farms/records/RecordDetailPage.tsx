/* eslint-disable @typescript-eslint/no-explicit-any -- generic record engine: shape is driven by the per-kind config/schema */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { BreedingRecordDTO, RecordHistoryEntry, RecordMeta } from '@farmplus/shared-types';
import { api } from '../../../api';
import { Alert, Badge, Button, Card, Modal, Textarea } from '../../../components/ui';
import { errorMessage } from '../../../lib/format';
import { useAsync } from '../../../lib/useAsync';
import { NavButton } from '../NavButton';
import { enumLabel, useFarmFormat, useFarmsT } from '../labels';
import { useFarm } from '../useFarmAccess';
import { BreedingActions } from './BreedingActions';
import { RecordHistoryPanel } from './RecordHistoryPanel';
import type { KindConfig } from './recordConfigs';

type Full = RecordMeta & { history: RecordHistoryEntry[] } & Record<string, any>;

/** `/farms/:farmId/<kind>/:id`: the record, what happened to it, and the actions the caller may take. */
export default function RecordDetailPage({ config }: { config: KindConfig }) {
  const t = useFarmsT();
  const fmt = useFarmFormat();
  const { farmId = '', id = '' } = useParams();
  const { farm, can } = useFarm(farmId);
  const [version, setVersion] = useState(0);
  const base = `/farms/${farmId}/${config.path}`;
  const { data, loading, error, reload } = useAsync(
    (signal) => api.request<{ record: Full }>('GET', `${base}/${id}`, { signal }),
    [farmId, id, version],
  );
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [voidError, setVoidError] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (error)
    return (
      <Alert tone="danger">
        {error}{' '}
        <button type="button" onClick={reload}>
          {t('common.tryAgain')}
        </button>
      </Alert>
    );
  if (loading && !data) return <p role="status">{t('common.loading')}</p>;
  const r = data?.record;
  if (!r) return null;

  const active = farm?.status === 'active' && !r.voided;
  const canWrite = can(config.permissions.write) && active;
  const canCorrect = can(config.permissions.correct) && active;
  const refresh = () => setVersion((v) => v + 1);
  const rows = config.describe(r, t, fmt).filter(([, v]) => v !== undefined && v !== '');

  const doVoid = async () => {
    setBusy(true);
    setVoidError(undefined);
    try {
      await api.request('POST', `${base}/${id}/void`, { body: { reason: reason.trim() } });
      setVoiding(false);
      setReason('');
      refresh();
    } catch (e) {
      setVoidError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p>
        <Link to={base}>← {t(config.plural)}</Link>
      </p>
      <div className="ds-row" style={{ justifyContent: 'space-between' }}>
        <h1>{config.title(r, t, fmt)}</h1>
        <span className="ds-row">
          {r.voided && <Badge tone="danger">{t('common.voided')}</Badge>}
          {r.revision > 1 && !r.voided && (
            <Badge>{t('rec.detail.revision', { revision: r.revision })}</Badge>
          )}
        </span>
      </div>
      {config.notice && <Alert tone="warning">{t(config.notice)}</Alert>}
      {r.voided && (
        <Alert tone="danger">
          {t('rec.detail.voidedNotice', {
            name: r.voided.by.displayName,
            date: fmt.dateTime(r.voided.at),
            reason: r.voided.reason,
          })}
        </Alert>
      )}
      {config.kind === 'breeding' &&
        (r as unknown as BreedingRecordDTO).warnings.map((w) => (
          <Alert key={w} tone="info">
            {w}
          </Alert>
        ))}

      <div className="ds-row" style={{ margin: 'var(--ds-space-3) 0' }}>
        {canCorrect && (
          <NavButton to={`${base}/${id}/edit`} variant="primary">
            {t('rec.detail.correct')}
          </NavButton>
        )}
        {canCorrect && (
          <Button
            variant="danger"
            onClick={() => {
              setVoiding(true);
              setVoidError(undefined);
            }}
          >
            {t('rec.detail.void')}
          </Button>
        )}
      </div>

      <div className="ds-grid ds-grid--2">
        <Card title={t('common.details')} headingLevel={2}>
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'max-content 1fr',
              gap: 'var(--ds-space-2) var(--ds-space-4)',
              margin: 0,
            }}
          >
            {rows.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt style={{ color: 'var(--ds-text-muted)' }}>{k}</dt>
                <dd style={{ margin: 0 }}>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="ds-field__hint" style={{ marginTop: 'var(--ds-space-3)' }}>
            {t('rec.detail.recordedBy', {
              name: r.createdBy.displayName,
              date: fmt.dateTime(r.createdAt),
            })}
            {r.updatedBy
              ? ` · ${t('rec.detail.changedBy', { name: r.updatedBy.displayName, date: fmt.dateTime(r.updatedAt) })}`
              : ''}
          </p>
          {config.kind === 'breeding' && (r as unknown as BreedingRecordDTO).delivery && (
            <>
              <h3>{t('rec.detail.offspring')}</h3>
              <ul>
                {(r as unknown as BreedingRecordDTO).delivery!.offspring.map((o, i) => (
                  <li key={i}>
                    {o.animal ? (
                      <Link to={`/farms/${farmId}/animals/${o.animal.id}`}>
                        {o.animal.animalCode}
                        {o.animal.name ? ` — ${o.animal.name}` : ''}
                      </Link>
                    ) : (
                      t('rec.detail.noIdentity', {
                        outcome: enumLabel(t, 'offspringOutcome', o.outcome),
                      })
                    )}
                    {o.sex ? ` · ${enumLabel(t, 'sexRaw', o.sex)}` : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
        <div>
          {config.kind === 'breeding' && (
            <BreedingActions
              farmId={farmId}
              record={r as unknown as BreedingRecordDTO}
              canWrite={canWrite}
              onChanged={refresh}
            />
          )}
          <RecordHistoryPanel
            basePath={base}
            record={r}
            history={r.history}
            canWrite={canWrite}
            canCorrect={canCorrect}
            onChanged={refresh}
            allowUpload={config.kind === 'breeding'}
          />
        </div>
      </div>

      <Modal
        open={voiding}
        onClose={() => setVoiding(false)}
        title={t('rec.detail.voidTitle')}
        footer={
          <>
            <Button onClick={() => setVoiding(false)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={reason.trim().length < 3}
              onClick={() => void doVoid()}
            >
              {t('rec.detail.voidRecord')}
            </Button>
          </>
        }
      >
        <p>
          {t('rec.detail.voidExplain1')} <strong>{t('rec.detail.voidNotDeleted')}</strong>
          {t('rec.detail.voidExplain2')}
        </p>
        <Textarea
          label={t('common.reason')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
        />
        {voidError && <Alert tone="danger">{voidError}</Alert>}
      </Modal>
    </>
  );
}
