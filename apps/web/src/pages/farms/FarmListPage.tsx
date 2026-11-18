import { Link } from 'react-router-dom';
import type { FarmSummary, Page } from '@farmplus/shared-types';
import { api } from '../../api';
import { Alert, Badge, Card, Pagination, TextField } from '../../components/ui';
import { NavButton } from './NavButton';
import { useAsync } from '../../lib/useAsync';
import { useListParams } from '../../lib/useListParams';
import { roleLabel, useFarmsT } from './labels';

const DEFAULTS = { q: '', page: '1' };

export default function FarmListPage() {
  const t = useFarmsT();
  const [params, setParams] = useListParams(DEFAULTS);
  const { data, loading, error, reload } = useAsync(
    (signal) =>
      api.request<Page<FarmSummary>>('GET', '/farms', {
        query: { q: params['q'], page: params['page'], pageSize: 12 },
        signal,
      }),
    [params],
  );
  return (
    <>
      <div className="ds-row" style={{ justifyContent: 'space-between' }}>
        <h1>{t('list.title')}</h1>
        <NavButton to="/farms/new" variant="primary">
          {t('list.create')}
        </NavButton>
      </div>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setParams({ q: String(new FormData(e.currentTarget).get('q') ?? '').trim() });
        }}
      >
        <TextField
          key={params['q']}
          label={t('list.search')}
          name="q"
          defaultValue={params['q']}
          type="search"
        />
      </form>
      {error && (
        <Alert tone="danger">
          {error}{' '}
          <button type="button" onClick={reload}>
            {t('common.tryAgain')}
          </button>
        </Alert>
      )}
      {loading && !data && <p role="status">{t('list.loading')}</p>}
      {data && data.items.length === 0 && (
        <Card title={t('list.emptyTitle')}>
          <p>{params['q'] ? t('list.noMatch') : t('list.emptyHint')}</p>
        </Card>
      )}
      <div className="ds-grid ds-grid--3">
        {data?.items.map((farm) => (
          <Card
            key={farm.id}
            title={<Link to={`/farms/${farm.id}`}>{farm.name}</Link>}
            headingLevel={2}
          >
            <p className="ds-row">
              {farm.myRole && <Badge tone="info">{roleLabel(t, farm.myRole)}</Badge>}
              {farm.status === 'archived' && <Badge tone="warning">{t('common.archived')}</Badge>}
            </p>
            <p>
              {[farm.location.district, farm.location.province].filter(Boolean).join(', ') ||
                t('common.locationNotSet')}
            </p>
          </Card>
        ))}
      </div>
      {data && (
        <Pagination
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          loading={loading}
          onPageChange={(p) => setParams({ page: String(p) })}
        />
      )}
    </>
  );
}
