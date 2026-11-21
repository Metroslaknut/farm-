import { Link } from 'react-router-dom';
import type { FarmSummary, Page } from '@farmplus/shared-types';
import { api } from '../../api';
import { Alert, Badge, Card, Pagination, TextField } from '../../components/ui';
import { NavButton } from './NavButton';
import { useAsync } from '../../lib/useAsync';
import { useListParams } from '../../lib/useListParams';
import { roleLabel, useFarmsT } from './labels';

const DEFAULTS = { q: '', owned: '1', managed: '1' };

/** One section of the list: the farms I own, or the farms I help run (each with its own paging). */
function FarmSection({
  relation,
  q,
  page,
  onPage,
}: {
  relation: 'owned' | 'managed';
  q: string;
  page: string;
  onPage: (p: number) => void;
}) {
  const t = useFarmsT();
  const { data, loading, error, reload } = useAsync(
    (signal) =>
      api.request<Page<FarmSummary>>('GET', '/farms', {
        query: { q, relation, page, pageSize: 12 },
        signal,
      }),
    [q, relation, page],
  );
  return (
    <section aria-label={t(`list.${relation}`)} style={{ marginBottom: 'var(--ds-space-5)' }}>
      <h2>{t(`list.${relation}`)}</h2>
      {error && (
        <Alert tone="danger">
          {error}{' '}
          <button type="button" onClick={reload}>
            {t('common.tryAgain')}
          </button>
        </Alert>
      )}
      {loading && !data && <p role="status">{t('list.loading')}</p>}
      {data && data.items.length === 0 && relation === 'owned' && (
        <Card title={t('list.emptyTitle')}>
          <p>{q ? t('list.noMatch') : t('list.emptyHint')}</p>
        </Card>
      )}
      {data && data.items.length === 0 && relation === 'managed' && (
        <p className="ds-field__hint">{q ? t('list.noMatch') : t('list.noManaged')}</p>
      )}
      <div className="ds-grid ds-grid--3">
        {data?.items.map((farm) => (
          <Card
            key={farm.id}
            title={<Link to={`/farms/${farm.id}`}>{farm.name}</Link>}
            headingLevel={3}
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
      {data && data.total > data.pageSize && (
        <Pagination
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          loading={loading}
          onPageChange={onPage}
        />
      )}
    </section>
  );
}

/** `/farms/list`: farms I own and farms I help run, kept apart (one account can be both). */
export default function FarmListPage() {
  const t = useFarmsT();
  const [params, setParams] = useListParams(DEFAULTS);
  const q = params['q'] ?? '';
  return (
    <>
      <div className="ds-row" style={{ justifyContent: 'space-between' }}>
        <h1>{t('list.title')}</h1>
        <span className="ds-row">
          <NavButton to="/farms/invitations">{t('shell.invitations')}</NavButton>
          <NavButton to="/farms/new" variant="primary">
            {t('list.create')}
          </NavButton>
        </span>
      </div>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setParams({
            q: String(new FormData(e.currentTarget).get('q') ?? '').trim(),
            owned: '1',
            managed: '1',
          });
        }}
      >
        <TextField key={q} label={t('list.search')} name="q" defaultValue={q} type="search" />
      </form>
      <FarmSection
        relation="owned"
        q={q}
        page={params['owned'] ?? '1'}
        onPage={(p) => setParams({ owned: String(p) })}
      />
      <FarmSection
        relation="managed"
        q={q}
        page={params['managed'] ?? '1'}
        onPage={(p) => setParams({ managed: String(p) })}
      />
    </>
  );
}
