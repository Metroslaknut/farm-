/* eslint-disable @typescript-eslint/no-explicit-any -- generic record engine: shape is driven by the per-kind config/schema */
import { Link, useParams } from 'react-router-dom';
import type { AnimalSummary, ExpenseSummary, Page } from '@farmplus/shared-types';
import { api } from '../../../api';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Pagination,
  Select,
  Table,
  TextField,
  type TableColumn,
} from '../../../components/ui';
import { useAsync } from '../../../lib/useAsync';
import { useListParams } from '../../../lib/useListParams';
import { NavButton } from '../NavButton';
import { bahtLabel, enumLabel, useFarmFormat, useFarmsT } from '../labels';
import { useFarm } from '../useFarmAccess';
import type { KindConfig } from './recordConfigs';

const PAGE_SIZE = 15;

function SpendingSummary({ farmId, params }: { farmId: string; params: Record<string, string> }) {
  const t = useFarmsT();
  const money = bahtLabel;
  const { data } = useAsync(
    (signal) =>
      api.request<{ summary: ExpenseSummary }>('GET', `/farms/${farmId}/expenses/summary`, {
        query: { from: params['from'], to: params['to'], animalId: params['animalId'] },
        signal,
      }),
    [farmId, params['from'], params['to'], params['animalId']],
  );
  if (!data) return null;
  const s = data.summary;
  return (
    <Card
      title={t('rec.list.spending')}
      headingLevel={2}
      style={{ marginBottom: 'var(--ds-space-4)' }}
      data-tour="records-spending"
    >
      <p>
        <strong style={{ fontSize: 'var(--ds-text-xl)' }}>
          {t('rec.list.total', { amount: money(s.total) })}
        </strong>{' '}
        {t('rec.list.across', { count: s.count })}
      </p>
      <p className="ds-row">
        {s.byCategory.map((c) => (
          <Badge key={c.category} tone="info">
            {enumLabel(t, 'expenseCategory', c.category)}: {money(c.total)}
          </Badge>
        ))}
      </p>
      {s.byMonth.length > 0 && (
        <p className="ds-field__hint">
          {t('rec.list.byMonth', {
            months: s.byMonth.map((m) => `${m.month} ${money(m.total)}`).join(' · '),
          })}
        </p>
      )}
    </Card>
  );
}

/** One list screen for every record kind: filters (animal, kind-specific, dates), voided toggle, pagination. */
export default function RecordListPage({ config }: { config: KindConfig }) {
  const t = useFarmsT();
  const fmt = useFarmFormat();
  const { farmId = '' } = useParams();
  const { farm, can } = useFarm(farmId);
  const defaults: Record<string, string> = {
    animalId: '',
    from: '',
    to: '',
    includeVoided: 'false',
    page: '1',
    ...Object.fromEntries((config.filters ?? []).map((f) => [f.name, ''])),
  };
  const [params, setParams] = useListParams(defaults);
  const animals = useAsync(
    (signal) =>
      api.request<Page<AnimalSummary>>('GET', `/farms/${farmId}/animals`, {
        query: { pageSize: 100, archived: 'all', sortBy: 'animalCode', order: 'asc' },
        signal,
      }),
    [farmId],
  );
  const filterKey = config.animalFilterName ?? 'animalId';
  const list = useAsync(
    async (signal) => ({
      kind: config.kind,
      page: await api.request<Page<any>>('GET', `/farms/${farmId}/${config.path}`, {
        query: {
          ...Object.fromEntries(Object.entries(params).filter(([k]) => k !== 'animalId')),
          [filterKey]: params['animalId'],
          pageSize: PAGE_SIZE,
          order: 'desc',
        },
        signal,
      }),
    }),
    [farmId, params, config.path],
  );
  // useAsync keeps the previous result while the next one loads: never show one kind's rows with another kind's
  // columns (the routes also remount this page per kind; this is the second guard).
  const data = list.data?.kind === config.kind ? list.data.page : undefined;
  const { loading, error, reload } = list;
  const canWrite = can(config.permissions.write) && farm?.status === 'active';

  const columns: TableColumn<any>[] = [
    ...config.columns.map((c, i) => ({
      key: String(i),
      header: t(c.header),
      cell: (r: any) =>
        i === 0 ? (
          <Link to={`/farms/${farmId}/${config.path}/${r.id}`}>{c.cell(r, t, fmt) || '—'}</Link>
        ) : (
          c.cell(r, t, fmt) || '—'
        ),
    })),
    {
      key: 'state',
      header: '',
      cell: (r: any) =>
        r.voided ? (
          <Badge tone="warning">{t('common.voided')}</Badge>
        ) : r.revision > 1 ? (
          <Badge>{t('rec.list.corrected')}</Badge>
        ) : null,
    },
  ];

  return (
    <>
      <p>
        <Link to={`/farms/${farmId}`}>← {farm?.name ?? t('common.farm')}</Link>
      </p>
      <div className="ds-row" style={{ justifyContent: 'space-between' }}>
        <h1>{t(config.plural)}</h1>
        {canWrite && (
          <NavButton
            to={`/farms/${farmId}/${config.path}/new`}
            variant="primary"
            data-tour="records-add"
          >
            {t('rec.list.add', { singular: t(config.singular) })}
          </NavButton>
        )}
      </div>
      {config.kind === 'expense' && <SpendingSummary farmId={farmId} params={params} />}
      <form
        className="ds-grid ds-grid--3"
        onSubmit={(e) => e.preventDefault()}
        data-tour="records-filters"
      >
        <Select
          label={config.kind === 'breeding' ? t('detail.dam') : t('common.animal')}
          value={params['animalId']}
          onChange={(e) => setParams({ animalId: e.target.value })}
        >
          <option value="">
            {config.kind === 'breeding' ? t('rec.list.allDams') : t('rec.list.allAnimals')}
          </option>
          {animals.data?.items.map((a) => (
            <option key={a.id} value={a.id}>
              {a.animalCode}
              {a.name ? ` — ${a.name}` : ''}
            </option>
          ))}
        </Select>
        {config.filters?.map((f) => (
          <Select
            key={f.name}
            label={t(f.label)}
            value={params[f.name]}
            onChange={(e) => setParams({ [f.name]: e.target.value })}
          >
            <option value="">{t('common.all')}</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {t(o.label)}
              </option>
            ))}
          </Select>
        ))}
        <TextField
          label={t('rec.list.from')}
          type="date"
          value={params['from']}
          onChange={(e) => setParams({ from: e.target.value })}
        />
        <TextField
          label={t('rec.list.to')}
          type="date"
          value={params['to']}
          onChange={(e) => setParams({ to: e.target.value })}
        />
        <div className="ds-row" style={{ alignSelf: 'end', marginBottom: 'var(--ds-space-4)' }}>
          <Checkbox
            label={t('rec.list.showVoided')}
            data-tour="records-show-voided"
            checked={params['includeVoided'] === 'true'}
            onChange={(e) => setParams({ includeVoided: e.target.checked ? 'true' : 'false' })}
          />
          <Button
            onClick={() =>
              setParams(
                Object.fromEntries(
                  Object.keys(defaults)
                    .filter((k) => k !== 'page')
                    .map((k) => [k, defaults[k]!]),
                ),
              )
            }
          >
            {t('common.reset')}
          </Button>
        </div>
      </form>
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
        <>
          <Table
            caption={t(config.plural)}
            columns={columns}
            rows={data.items}
            rowKey={(r) => r.id}
            emptyMessage={t('rec.list.empty')}
          />
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            loading={loading}
            onPageChange={(p) => setParams({ page: String(p) })}
          />
        </>
      )}
    </>
  );
}
