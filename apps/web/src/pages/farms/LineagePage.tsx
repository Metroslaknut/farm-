import { Link, useParams } from 'react-router-dom';
import type { AnimalSummary, Page } from '@farmplus/shared-types';
import { api } from '../../api';
import { Alert, Pagination, Select, Table, TextField } from '../../components/ui';
import { useLocale } from '../../i18n';
import { loadAnimalTypes } from '../../lib/animalTypes';
import { useAsync } from '../../lib/useAsync';
import { useListParams } from '../../lib/useListParams';
import { NavButton } from './NavButton';
import { ageLabel, enumLabel, typeName, useFarmsT } from './labels';
import { useFarm } from './useFarmAccess';

const DEFAULTS = { q: '', animalTypeId: '', page: '1' };

/** `/farms/:farmId/lineage` — the "Breeding & lineage" section: pick an animal to open its pedigree. */
export default function LineagePage() {
  const t = useFarmsT();
  const [locale] = useLocale();
  const { farmId = '' } = useParams();
  const { can } = useFarm(farmId);
  const [params, setParams] = useListParams(DEFAULTS);
  const types = useAsync(() => loadAnimalTypes(), []);
  const { data, error, loading, reload } = useAsync(
    (signal) =>
      api.request<Page<AnimalSummary>>('GET', `/farms/${farmId}/animals`, {
        query: { ...params, pageSize: 25, sortBy: 'animalCode', order: 'asc' },
        signal,
      }),
    [farmId, params],
  );
  return (
    <>
      <p>
        <Link to={`/farms/${farmId}`}>{t('common.back')}</Link>
      </p>
      <div className="ds-row" style={{ justifyContent: 'space-between' }}>
        <h1>{t('lineage.title')}</h1>
        {can('breeding.read') && (
          <NavButton to={`/farms/${farmId}/breeding`}>{t('lineage.breedingRecords')}</NavButton>
        )}
      </div>
      <p>{t('lineage.intro')}</p>
      <form
        role="search"
        className="ds-row"
        onSubmit={(e) => {
          e.preventDefault();
          setParams({ q: String(new FormData(e.currentTarget).get('q') ?? '').trim(), page: '1' });
        }}
      >
        <TextField
          key={params['q']}
          label={t('list.search')}
          name="q"
          type="search"
          defaultValue={params['q']}
        />
        <Select
          label={t('animals.col.type')}
          value={params['animalTypeId']}
          onChange={(e) => setParams({ animalTypeId: e.target.value, page: '1' })}
        >
          <option value="">{t('animals.allTypes')}</option>
          {types.data?.animalTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {typeName(type, locale)}
            </option>
          ))}
        </Select>
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
          <Table<AnimalSummary>
            caption={t('lineage.title')}
            rowKey={(a) => a.id}
            rows={data.items}
            emptyMessage={t('list.noMatch')}
            columns={[
              {
                key: 'code',
                header: t('animals.col.code'),
                cell: (a) => (
                  <Link to={`/farms/${farmId}/animals/${a.id}/lineage`}>
                    {a.animalCode}
                    {a.name ? ` — ${a.name}` : ''}
                  </Link>
                ),
              },
              {
                key: 'type',
                header: t('animals.col.type'),
                cell: (a) => typeName(a.animalType, locale),
              },
              { key: 'sex', header: t('animals.col.sex'), cell: (a) => enumLabel(t, 'sex', a.sex) },
              {
                key: 'age',
                header: t('animals.col.age'),
                cell: (a) => ageLabel(t, a.birthDate) ?? '—',
              },
              {
                key: 'status',
                header: t('animals.col.status'),
                cell: (a) => enumLabel(t, 'status', a.currentStatus),
              },
            ]}
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
