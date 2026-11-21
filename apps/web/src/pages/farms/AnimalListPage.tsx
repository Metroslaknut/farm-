import { Link, useParams } from 'react-router-dom';
import {
  ANIMAL_SEXES,
  ANIMAL_STATUSES,
  type AnimalSummary,
  type Page,
} from '@farmplus/shared-types';
import { api } from '../../api';
import {
  Alert,
  Badge,
  Button,
  Pagination,
  Select,
  Table,
  TextField,
  type TableColumn,
} from '../../components/ui';
import { useLocale } from '../../i18n';
import { loadAnimalTypes } from '../../lib/animalTypes';
import { useAsync } from '../../lib/useAsync';
import { useListParams } from '../../lib/useListParams';
import { NavButton } from './NavButton';
import { STATUS_TONE, ageLabel, breedLabel, enumLabel, typeName, useFarmsT } from './labels';
import { useFarm } from './useFarmAccess';

const DEFAULTS = {
  q: '',
  animalTypeId: '',
  breedGroup: '',
  sex: '',
  status: '',
  archived: 'false',
  sortBy: 'createdAt',
  order: 'desc',
  page: '1',
};
const PAGE_SIZE = 15;

export default function AnimalListPage() {
  const t = useFarmsT();
  const [locale] = useLocale();
  const { farmId } = useParams();
  const { farm, can } = useFarm(farmId);
  const [params, setParams] = useListParams(DEFAULTS);
  const types = useAsync(() => loadAnimalTypes(), []);
  const { data, loading, error, reload } = useAsync(
    (signal) =>
      api.request<Page<AnimalSummary>>('GET', `/farms/${farmId}/animals`, {
        query: { ...params, pageSize: PAGE_SIZE },
        signal,
      }),
    [farmId, params],
  );

  const groups =
    types.data?.animalTypes.find((x) => x.id === params['animalTypeId'])?.breedGroups ?? [];
  const columns: TableColumn<AnimalSummary>[] = [
    {
      key: 'code',
      header: t('animals.col.code'),
      sortKey: 'animalCode',
      cell: (a) => <Link to={`/farms/${farmId}/animals/${a.id}`}>{a.animalCode}</Link>,
    },
    { key: 'name', header: t('animals.col.name'), sortKey: 'name', cell: (a) => a.name ?? '—' },
    {
      key: 'type',
      header: t('animals.col.type'),
      cell: (a) =>
        [typeName(a.animalType, locale), breedLabel(a, locale)].filter(Boolean).join(' · '),
    },
    { key: 'sex', header: t('animals.col.sex'), cell: (a) => enumLabel(t, 'sex', a.sex) },
    {
      key: 'age',
      header: t('animals.col.age'),
      sortKey: 'birthDate',
      cell: (a) => ageLabel(t, a.birthDate) ?? '—',
    },
    {
      key: 'status',
      header: t('animals.col.status'),
      cell: (a) => (
        <span className="ds-row">
          <Badge tone={STATUS_TONE[a.currentStatus]}>
            {enumLabel(t, 'status', a.currentStatus)}
          </Badge>
          {a.archived && <Badge tone="warning">{t('common.archived')}</Badge>}
        </span>
      ),
    },
  ];

  const onSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setParams({ q: String(new FormData(e.currentTarget).get('q') ?? '').trim() });
  };

  return (
    <>
      <p>
        <Link to={`/farms/${farmId}`}>← {farm?.name ?? t('common.farm')}</Link>
      </p>
      <div className="ds-row" style={{ justifyContent: 'space-between' }}>
        <h1>{t('animals.title')}</h1>
        {can('animals.write') && farm?.status === 'active' && (
          <NavButton to={`/farms/${farmId}/animals/new`} variant="primary">
            {t('animals.register')}
          </NavButton>
        )}
      </div>

      <form role="search" onSubmit={onSearch} className="fd-filters">
        <TextField
          key={params['q']}
          label={t('animals.search')}
          name="q"
          type="search"
          defaultValue={params['q']}
        />
        <Select
          label={t('animals.col.type')}
          value={params['animalTypeId']}
          onChange={(e) => setParams({ animalTypeId: e.target.value, breedGroup: '' })}
        >
          <option value="">{t('animals.allTypes')}</option>
          {types.data?.animalTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {typeName(type, locale)}
            </option>
          ))}
        </Select>
        {groups.length > 0 && (
          <Select
            label={t('animalForm.breedGroup')}
            value={params['breedGroup']}
            onChange={(e) => setParams({ breedGroup: e.target.value })}
          >
            <option value="">{t('animalForm.allGroups')}</option>
            {groups.map((g) => (
              <option key={g.key} value={g.key}>
                {typeName(g, locale)}
              </option>
            ))}
          </Select>
        )}
        <Select
          label={t('animals.col.sex')}
          value={params['sex']}
          onChange={(e) => setParams({ sex: e.target.value })}
        >
          <option value="">{t('common.all')}</option>
          {ANIMAL_SEXES.map((s) => (
            <option key={s} value={s}>
              {enumLabel(t, 'sex', s)}
            </option>
          ))}
        </Select>
        <Select
          label={t('animals.col.status')}
          value={params['status']}
          onChange={(e) => setParams({ status: e.target.value })}
        >
          <option value="">{t('animals.allStatuses')}</option>
          {ANIMAL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {enumLabel(t, 'status', s)}
            </option>
          ))}
        </Select>
        <Select
          label={t('animals.records')}
          value={params['archived']}
          onChange={(e) => setParams({ archived: e.target.value })}
        >
          <option value="false">{t('animals.records.current')}</option>
          <option value="true">{t('common.archived')}</option>
          <option value="all">{t('common.all')}</option>
        </Select>
        <div className="fd-filters__actions">
          <Button type="submit" variant="primary">
            {t('common.search')}
          </Button>
          <Button
            onClick={() =>
              setParams({
                q: '',
                animalTypeId: '',
                breedGroup: '',
                sex: '',
                status: '',
                archived: 'false',
              })
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
      {loading && !data && <p role="status">{t('animals.loading')}</p>}
      {data && (
        <>
          <Table
            caption={t('animals.title')}
            columns={columns}
            rows={data.items}
            rowKey={(a) => a.id}
            sort={{ by: params['sortBy']!, order: params['order'] === 'asc' ? 'asc' : 'desc' }}
            onSortChange={(s) => setParams({ sortBy: s.by, order: s.order })}
            emptyMessage={t('animals.empty')}
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
