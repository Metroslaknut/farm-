import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  HISTORY_EVENT_TYPES,
  type HistoryEvent,
  type HistoryEventType,
  type LineageResponse,
  type Page,
} from '@farmplus/shared-types';
import { api } from '../../../api';
import { Alert, Badge, Card, Pagination, Select } from '../../../components/ui';
import { useAsync } from '../../../lib/useAsync';
import { enumLabel, useFarmFormat, useFarmsT } from '../labels';
import { useFarm } from '../useFarmAccess';
import { KINDS } from './recordConfigs';

const LINK: Partial<Record<HistoryEventType, string>> = {
  breeding: 'breeding',
  health: 'health',
  weight: 'weights',
  feeding: 'feeding',
  expense: 'expenses',
};

/** `/farms/:farmId/animals/:animalId/history`: everything recorded about one animal, newest first, with its lineage. */
export default function AnimalHistoryPage() {
  const t = useFarmsT();
  const { date: formatDate } = useFarmFormat();
  const { farmId = '', animalId = '' } = useParams();
  useFarm(farmId);
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const history = useAsync(
    (signal) =>
      api.request<Page<HistoryEvent> & { animal: { animalCode: string } }>(
        'GET',
        `/farms/${farmId}/animals/${animalId}/history`,
        { query: { page, pageSize: 30, ...(type ? { types: type } : {}) }, signal },
      ),
    [farmId, animalId, type, page],
  );
  const lineage = useAsync(
    (signal) =>
      api.request<LineageResponse>('GET', `/farms/${farmId}/animals/${animalId}/lineage`, {
        signal,
      }),
    [farmId, animalId],
  );
  void KINDS;
  const d = history.data;
  const l = lineage.data;
  const ref = (a: { id: string; animalCode: string; name?: string | undefined }) => (
    <Link to={`/farms/${farmId}/animals/${a.id}`}>
      {a.animalCode}
      {a.name ? ` — ${a.name}` : ''}
    </Link>
  );
  return (
    <>
      <p>
        <Link to={`/farms/${farmId}/animals/${animalId}`}>{t('common.backToAnimal')}</Link>
      </p>
      <h1>
        {t('detail.history')}
        {l ? ` — ${l.animal.animalCode}` : ''}
      </h1>
      {history.error && <Alert tone="danger">{history.error}</Alert>}
      <div className="ds-grid ds-grid--2">
        <Card title={t('hist.lineage')} headingLevel={2}>
          {l ? (
            <>
              <p>
                {t('hist.sire')} {l.sire ? ref(l.sire) : t('hist.notRecorded')}
              </p>
              <p>
                {t('hist.dam')} {l.dam ? ref(l.dam) : t('hist.notRecorded')}
              </p>
              <p>{t('hist.offspring', { count: l.offspring.length })}</p>
              <ul>
                {l.offspring.map((o) => (
                  <li key={o.id}>
                    {ref(o)} · {enumLabel(t, 'sex', o.sex)}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p role="status">{t('common.loading')}</p>
          )}
        </Card>
        <Card title={t('hist.filter')} headingLevel={2}>
          <Select
            label={t('hist.show')}
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('hist.everything')}</option>
            {HISTORY_EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {enumLabel(t, 'historyType', type)}
              </option>
            ))}
          </Select>
        </Card>
      </div>
      <ol
        style={{
          listStyle: 'none',
          padding: 0,
          display: 'grid',
          gap: 'var(--ds-space-3)',
          marginTop: 'var(--ds-space-4)',
        }}
        aria-label={t('hist.timeline')}
      >
        {history.loading && !d && <li role="status">{t('common.loading')}</li>}
        {d?.items.length === 0 && <li>{t('hist.empty')}</li>}
        {d?.items.map((e) => (
          <li key={e.key} className="ds-card" style={{ padding: 'var(--ds-space-3)' }}>
            <div className="ds-row">
              <Badge>{enumLabel(t, 'historyType', e.type)}</Badge>
              <strong>
                {LINK[e.type] && e.recordId ? (
                  <Link to={`/farms/${farmId}/${LINK[e.type]}/${e.recordId}`}>{e.title}</Link>
                ) : (
                  e.title
                )}
              </strong>
              {e.voided && <Badge tone="danger">{t('common.voided')}</Badge>}
              <span className="ds-field__hint">
                {formatDate(e.date)}
                {e.by ? ` · ${e.by.displayName}` : ''}
              </span>
            </div>
            {e.summary && <p style={{ margin: 0 }}>{e.summary}</p>}
          </li>
        ))}
      </ol>
      {d && (
        <Pagination
          page={d.page}
          pageSize={d.pageSize}
          total={d.total}
          loading={history.loading}
          onPageChange={setPage}
        />
      )}
    </>
  );
}
