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
import { formatBaht, humanize } from '@farmplus/shared-utils';
import farmsCatalog from '../../../i18n/messages/farms';
import { enumLabel, useFarmFormat, useFarmsT, type FarmsKey } from '../labels';
import { useFarm } from '../useFarmAccess';
import { KINDS } from './recordConfigs';

const LINK: Partial<Record<HistoryEventType, string>> = {
  breeding: 'breeding',
  health: 'health',
  weight: 'weights',
  feeding: 'feeding',
  expense: 'expenses',
};

type FarmsT = ReturnType<typeof useFarmsT>;
const known = (key: string): key is FarmsKey => Object.hasOwn(farmsCatalog.en, key);

/** Animal fields named in "Changed: …" (the audit trail stores field names). */
const FIELD_LABELS: Record<string, FarmsKey> = {
  animalCode: 'animalForm.code',
  name: 'animals.col.name',
  sex: 'animals.col.sex',
  breed: 'animalForm.breed',
  birthDate: 'detail.birthDate',
  origin: 'detail.origin',
};

/**
 * The event's title and summary in the reader's language, from its `detail` (values sent by the API). Events without a
 * known detail keep the API's English wording.
 */
export function eventText(t: FarmsT, e: HistoryEvent): { title: string; summary?: string } {
  const d = e.detail;
  const fallback = { title: e.title, ...(e.summary ? { summary: e.summary } : {}) };
  if (!d) return fallback;
  switch (d.kind) {
    case 'audit': {
      const key = `hist.ev.audit.${d.action}`;
      return {
        title: known(key) ? t(key) : e.title,
        ...(d.fields?.length
          ? {
              summary: t('hist.ev.changed', {
                fields: d.fields
                  .map((f) => (FIELD_LABELS[f] ? t(FIELD_LABELS[f]) : humanize(f)))
                  .join(', '),
              }),
            }
          : {}),
      };
    }
    case 'breeding': {
      const p = d.partner;
      const who = p.code ?? p.name;
      const partner = who
        ? t(p.role === 'sire' ? 'hist.ev.sire' : 'hist.ev.dam', { name: who })
        : t('hist.ev.noSire');
      return {
        title: t('hist.ev.breeding', { method: enumLabel(t, 'breedingMethod', d.method) }),
        summary: `${partner} · ${enumLabel(t, 'breedingStatus', d.status)}`,
      };
    }
    case 'delivery':
      return { title: t('hist.ev.delivery', { count: d.offspring }) };
    case 'breedingFailed':
      return { title: t('hist.ev.failed'), ...(d.reason ? { summary: d.reason } : {}) };
    case 'born':
      return {
        title: t('hist.ev.born'),
        summary: [
          d.damCode && t('hist.ev.dam', { name: d.damCode }),
          d.sireCode && t('hist.ev.sire', { name: d.sireCode }),
        ]
          .filter(Boolean)
          .join(' · '),
      };
    case 'health': {
      const bits = [
        d.condition &&
          t('hist.ev.condition', {
            condition: d.condition,
            who: d.statedBy ? enumLabel(t, 'statedBy', d.statedBy) : '—',
          }),
        d.medication && t('hist.ev.medication', { name: d.medication }),
        d.vaccine && t('hist.ev.vaccine', { name: d.vaccine }),
      ].filter(Boolean);
      return {
        title: t('hist.ev.health', {
          type: enumLabel(t, 'healthType', d.healthType),
          title: d.title,
        }),
        ...(bits.length ? { summary: bits.join(' · ') } : {}),
      };
    }
    case 'feeding':
      return {
        title: t(d.schedule ? 'hist.ev.feedSchedule' : 'hist.ev.fed', { feed: d.feedName }),
        summary: `${d.amount} ${enumLabel(t, 'unit', d.unit)}`,
      };
    case 'weight':
      return {
        title: t('hist.ev.weighed', { kg: d.weightKg }),
        summary: enumLabel(t, 'weighMethod', d.method),
      };
    case 'expense':
      return {
        title: t('hist.ev.expense', {
          category: enumLabel(t, 'expenseCategory', d.category),
          description: d.description,
        }),
        summary: formatBaht(d.amountMinor),
      };
    default:
      return fallback;
  }
}

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
        {d?.items.map((e) => {
          const text = eventText(t, e);
          return (
            <li key={e.key} className="ds-card" style={{ padding: 'var(--ds-space-3)' }}>
              <div className="ds-row">
                <Badge>{enumLabel(t, 'historyType', e.type)}</Badge>
                <strong>
                  {LINK[e.type] && e.recordId ? (
                    <Link to={`/farms/${farmId}/${LINK[e.type]}/${e.recordId}`}>{text.title}</Link>
                  ) : (
                    text.title
                  )}
                </strong>
                {e.voided && <Badge tone="danger">{t('common.voided')}</Badge>}
                <span className="ds-field__hint">
                  {formatDate(e.date)}
                  {e.by ? ` · ${e.by.displayName}` : ''}
                </span>
              </div>
              {text.summary && <p style={{ margin: 0 }}>{text.summary}</p>}
            </li>
          );
        })}
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
