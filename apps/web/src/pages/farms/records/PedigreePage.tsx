import { Link, useParams } from 'react-router-dom';
import type { LineageResponse, PedigreeAnimal, PedigreeNode } from '@farmplus/shared-types';
import { api } from '../../../api';
import { Alert, Badge, Card, Select, Table } from '../../../components/ui';
import { useAsync } from '../../../lib/useAsync';
import { useListParams } from '../../../lib/useListParams';
import { STATUS_TONE, ageLabel, enumLabel, useFarmFormat, useFarmsT } from '../labels';

const GENERATIONS = ['1', '2', '3', '4', '5'];

function AnimalBox({ farmId, a, root }: { farmId: string; a: PedigreeAnimal; root?: boolean }) {
  const t = useFarmsT();
  const { date } = useFarmFormat();
  return (
    <div
      style={{
        border: `${root ? 2 : 1}px solid var(${root ? '--ds-primary' : '--ds-border'})`,
        borderRadius: 'var(--ds-radius-md)',
        background: 'var(--ds-surface)',
        padding: 'var(--ds-space-2) var(--ds-space-3)',
        minWidth: '11rem',
      }}
    >
      <Link to={`/farms/${farmId}/animals/${a.id}`}>
        <strong>{a.animalCode}</strong>
        {a.name ? ` — ${a.name}` : ''}
      </Link>
      <div style={{ fontSize: 'var(--ds-text-sm)' }}>
        {[enumLabel(t, 'sex', a.sex), a.breed, a.birthDate && date(a.birthDate)]
          .filter(Boolean)
          .join(' · ')}
      </div>
      <div className="ds-row" style={{ gap: 'var(--ds-space-1)' }}>
        <Badge tone={STATUS_TONE[a.currentStatus]}>{enumLabel(t, 'status', a.currentStatus)}</Badge>
        {a.archived && <Badge tone="warning">{t('common.archived')}</Badge>}
      </div>
    </div>
  );
}

/**
 * The family tree, root on the left and ancestors to the right (one column per generation). Nested lists keep it
 * readable for screen readers ("Sire: …"); the container scrolls sideways on narrow screens.
 */
function Branch({
  farmId,
  node,
  depth,
  max,
}: {
  farmId: string;
  node: PedigreeNode;
  depth: number;
  max: number;
}) {
  const t = useFarmsT();
  const parents = [
    { key: 'sire', label: t('pedigree.sire'), child: node.sire },
    { key: 'dam', label: t('pedigree.dam'), child: node.dam },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ds-space-3)' }}>
      <AnimalBox farmId={farmId} a={node.animal} root={depth === 0} />
      {depth < max && (node.sire || node.dam) && (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            paddingLeft: 'var(--ds-space-3)',
            borderLeft: '2px solid var(--ds-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--ds-space-3)',
          }}
        >
          {parents.map((p) => (
            <li key={p.key}>
              <small className="ds-field__hint">{p.label}</small>
              {p.child ? (
                <Branch farmId={farmId} node={p.child} depth={depth + 1} max={max} />
              ) : (
                <div
                  style={{
                    border: '1px dashed var(--ds-border)',
                    borderRadius: 'var(--ds-radius-md)',
                    padding: 'var(--ds-space-2) var(--ds-space-3)',
                    color: 'var(--ds-text-muted)',
                  }}
                >
                  {t('pedigree.unknown')}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** `/farms/:farmId/animals/:animalId/lineage`: pedigree, siblings and offspring of one animal. */
export default function PedigreePage() {
  const t = useFarmsT();
  const { date } = useFarmFormat();
  const { farmId = '', animalId = '' } = useParams();
  const [params, setParams] = useListParams({ generations: '3' });
  const { data, error, loading, reload } = useAsync(
    (signal) =>
      api.request<LineageResponse>('GET', `/farms/${farmId}/animals/${animalId}/lineage`, {
        query: { generations: params['generations'] },
        signal,
      }),
    [farmId, animalId, params],
  );
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
  if (!data) return null;
  const hasParents = Boolean(data.pedigree.sire || data.pedigree.dam);
  return (
    <>
      <p>
        <Link to={`/farms/${farmId}/animals/${animalId}`}>← {data.animal.animalCode}</Link>
      </p>
      <h1>{t('pedigree.title', { code: data.animal.animalCode })}</h1>
      <p className="ds-field__hint">{t('pedigree.note')}</p>
      <Card title={t('pedigree.tree')} headingLevel={2}>
        <div className="ds-row" style={{ justifyContent: 'space-between' }}>
          <p>
            {data.generation > 0
              ? t('pedigree.generationCount', { n: data.generation })
              : t('pedigree.noParents')}
          </p>
          <Select
            label={t('pedigree.generations')}
            value={params['generations']}
            onChange={(e) => setParams({ generations: e.target.value })}
          >
            {GENERATIONS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Select>
        </div>
        <div style={{ overflowX: 'auto', paddingBottom: 'var(--ds-space-2)' }}>
          <Branch
            farmId={farmId}
            node={data.pedigree}
            depth={0}
            max={hasParents ? data.generations : 0}
          />
        </div>
      </Card>
      <div className="ds-grid ds-grid--2" style={{ marginTop: 'var(--ds-space-4)' }}>
        <Table
          caption={t('pedigree.siblings')}
          rowKey={(s) => s.id}
          rows={data.siblings}
          emptyMessage={t('pedigree.noSiblings')}
          columns={[
            {
              key: 'a',
              header: t('common.animal'),
              cell: (s) => (
                <Link to={`/farms/${farmId}/animals/${s.id}/lineage`}>
                  {s.animalCode}
                  {s.name ? ` — ${s.name}` : ''}
                </Link>
              ),
            },
            {
              key: 'r',
              header: t('pedigree.siblings'),
              cell: (s) => t(`pedigree.relation.${s.relation}`),
            },
            { key: 'x', header: t('animals.col.sex'), cell: (s) => enumLabel(t, 'sex', s.sex) },
            { key: 'b', header: t('detail.birthDate'), cell: (s) => date(s.birthDate) },
          ]}
        />
        <Table
          caption={t('pedigree.offspring')}
          rowKey={(o) => o.id}
          rows={data.offspring}
          emptyMessage={t('pedigree.noOffspring')}
          columns={[
            {
              key: 'a',
              header: t('common.animal'),
              cell: (o) => (
                <Link to={`/farms/${farmId}/animals/${o.id}/lineage`}>
                  {o.animalCode}
                  {o.name ? ` — ${o.name}` : ''}
                </Link>
              ),
            },
            { key: 'x', header: t('animals.col.sex'), cell: (o) => enumLabel(t, 'sex', o.sex) },
            {
              key: 'b',
              header: t('detail.birthDate'),
              cell: (o) =>
                o.birthDate ? `${date(o.birthDate)} (${ageLabel(t, o.birthDate) ?? ''})` : '—',
            },
            {
              key: 'r',
              header: t('lineage.col.parents'),
              cell: (o) =>
                t('pedigree.asParent', {
                  role: o.role === 'sire' ? t('pedigree.sire') : t('pedigree.dam'),
                }),
            },
          ]}
        />
      </div>
    </>
  );
}
