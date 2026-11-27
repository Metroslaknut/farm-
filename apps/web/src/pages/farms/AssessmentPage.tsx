import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  AssessmentDTO,
  AssessmentListItem,
  FactorStatus,
  Page,
  ReadinessFactor,
} from '@farmplus/shared-types';
import { formatBaht } from '@farmplus/shared-utils';
import { api } from '../../api';
import { Alert, Badge, Button, Card, Checkbox, Textarea, type Tone } from '../../components/ui';
import { errorMessage } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { loadAnimalTypes } from '../../lib/animalTypes';
import { enumLabel, typeName, useFarmFormat, useFarmsT, type FarmsKey } from './labels';
import { useFarm } from './useFarmAccess';

const STATUS_TONE: Record<FactorStatus, Tone> = {
  met: 'success',
  not_met: 'warning',
  unknown: 'neutral',
  info: 'info',
};
const STATUS_TEXT: Record<FactorStatus, FarmsKey> = {
  met: 'ai.factor.met',
  not_met: 'ai.factor.not_met',
  unknown: 'ai.factor.unknown',
  info: 'ai.factor.info',
};
/** Values of small enums the API sends, worded per language (`ai.<group>.<value>`), raw value if unknown. */
const aiLabel = (t: (k: FarmsKey) => string, group: string, value: string) => {
  const key = `ai.${group}.${value}` as FarmsKey;
  const text = t(key);
  return text === key ? value : text;
};
const SEVERITY_TONE = { info: 'info', caution: 'warning', serious: 'danger' } as const;

/** `/farms/:farmId/animals/:animalId/assessment` — decision support for a sale. Recorded data only; the owner decides. */
export default function AssessmentPage() {
  const t = useFarmsT();
  const fmt = useFarmFormat();
  const { farmId = '', animalId = '' } = useParams();
  const { can } = useFarm(farmId);
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [useAi, setUseAi] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const list = useAsync(
    (signal) =>
      api.request<Page<AssessmentListItem>>(
        'GET',
        `/farms/${farmId}/animals/${animalId}/assessments`,
        { signal, query: { pageSize: 20 } },
      ),
    [farmId, animalId, version],
  );
  const currentId = selected ?? list.data?.items[0]?.id;
  const current = useAsync(
    async (signal) =>
      currentId
        ? (
            await api.request<{ assessment: AssessmentDTO }>(
              'GET',
              `/farms/${farmId}/assessments/${currentId}`,
              { signal },
            )
          ).assessment
        : null,
    [farmId, currentId, version],
  );

  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const res = await api.request<{ assessment: AssessmentDTO }>(
        'POST',
        `/farms/${farmId}/animals/${animalId}/assessments`,
        { body: { includeAiExplanation: useAi } },
      );
      setSelected(res.assessment.id);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p>
        <Link to={`/farms/${farmId}/animals/${animalId}`}>{t('common.backToAnimal')}</Link>
      </p>
      <h1>{t('detail.saleAssessment')}</h1>
      <Alert tone="info">{t('ai.disclaimer')}</Alert>
      {error && <Alert tone="danger">{error}</Alert>}
      {can('records.read') && (
        <div className="ds-row" style={{ marginTop: 'var(--ds-space-3)' }}>
          <Button variant="primary" loading={busy} onClick={() => void run()}>
            {t('ai.run')}
          </Button>
          <Checkbox
            label={t('ai.useAi')}
            checked={useAi}
            onChange={(e) => setUseAi(e.target.checked)}
          />
        </div>
      )}
      {list.loading && !list.data && <p role="status">{t('common.loading')}</p>}
      {list.data && list.data.items.length === 0 && <p>{t('ai.empty')}</p>}
      {current.data && (
        <Result
          a={current.data}
          canReview={can('listings.manage')}
          onChanged={() => setVersion((v) => v + 1)}
        />
      )}
      {list.data && list.data.items.length > 1 && (
        <>
          <h2>{t('detail.history')}</h2>
          <ul aria-label={t('ai.historyAria')}>
            {list.data.items.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  className="ds-btn ds-btn--ghost ds-btn--sm"
                  aria-current={i.id === currentId}
                  onClick={() => setSelected(i.id)}
                >
                  {fmt.dateTime(i.assessmentDate)}
                </button>{' '}
                {i.priceRange
                  ? `${formatBaht(i.priceRange.lowMinor)}–${formatBaht(i.priceRange.highMinor)}`
                  : t('ai.noPriceRange')}{' '}
                ·{' '}
                {t('ai.historyLine', {
                  confidence: aiLabel(t, 'level', i.confidence),
                  review: aiLabel(t, 'reviewRaw', i.review),
                })}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function Result({
  a,
  canReview,
  onChanged,
}: {
  a: AssessmentDTO;
  canReview: boolean;
  onChanged: () => void;
}) {
  const t = useFarmsT();
  const fmt = useFarmFormat();
  // The assessment names the animal type in English: show the catalog's Thai name when there is one.
  const types = useAsync(() => loadAnimalTypes(), []);
  const type = types.data?.animalTypes?.find((x) => x.key === a.animalType.key);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const decide = async (decision: 'accepted' | 'dismissed') => {
    setError(undefined);
    try {
      await api.request('POST', `/farms/${a.farmId}/assessments/${a.id}/review`, {
        body: { decision, ...(note.trim() ? { note: note.trim() } : {}) },
      });
      setNote('');
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const dismissRec = async (rid: string) => {
    await api
      .request('POST', `/farms/${a.farmId}/assessments/${a.id}/recommendations/${rid}/dismiss`)
      .catch(() => undefined);
    onChanged();
  };
  const r = a.estimatedPriceRange;
  const c = a.costSummary;

  return (
    <div aria-label={t('ai.resultAria')}>
      <p className="ds-field__hint">
        {type ? typeName(type, fmt.locale) : a.animalType.name} · {a.animalCode} ·{' '}
        {t('ai.assessedOn', { date: fmt.dateTime(a.assessmentDate) })} ·{' '}
        <code>{a.modelVersion}</code>
      </p>
      <Card
        title={t('ai.confidenceTitle')}
        headingLevel={2}
        style={{ marginBottom: 'var(--ds-space-4)' }}
      >
        <p>
          <Badge
            tone={
              a.confidence.level === 'high'
                ? 'success'
                : a.confidence.level === 'medium'
                  ? 'warning'
                  : 'danger'
            }
          >
            {t('ai.confidence', { level: aiLabel(t, 'level', a.confidence.level) })}
          </Badge>
        </p>
        <p>{a.confidence.explanation}</p>
      </Card>

      {a.dataQualityWarnings.length > 0 && (
        <Card
          title={t('ai.missingTitle')}
          headingLevel={2}
          style={{ marginBottom: 'var(--ds-space-4)' }}
        >
          <ul aria-label={t('ai.warningsAria')}>
            {a.dataQualityWarnings.map((w) => (
              <li key={w.code}>
                <Badge tone={SEVERITY_TONE[w.severity]}>{aiLabel(t, 'severity', w.severity)}</Badge>{' '}
                {w.message}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title={t('ai.readinessTitle')}
        headingLevel={2}
        style={{ marginBottom: 'var(--ds-space-4)' }}
      >
        <p>
          {a.readinessScore !== null ? (
            <>
              <strong>{t('ai.score', { score: a.readinessScore })}</strong> —{' '}
            </>
          ) : (
            <strong>{t('ai.noScore')} </strong>
          )}
          {a.readinessScoreNote}
        </p>
        <p className="ds-field__hint">
          {t('ai.counts', {
            met: a.readinessCounts.met,
            notMet: a.readinessCounts.notMet,
            unknown: a.readinessCounts.unknown,
          })}
          {a.criteria
            ? ` · ${t(a.criteria.validated ? 'ai.criteriaValidated' : 'ai.criteriaNotValidated', {
                version: a.criteria.version,
                source: a.criteria.source,
              })}`
            : ''}
        </p>
        <FactorTable factors={a.readinessFactors} />
      </Card>

      <Card
        title={t('ai.priceTitle')}
        headingLevel={2}
        style={{ marginBottom: 'var(--ds-space-4)' }}
      >
        {r ? (
          <>
            <p style={{ fontSize: '1.25rem', margin: 0 }}>
              <strong>
                {formatBaht(r.lowMinor)} – {formatBaht(r.highMinor)}
              </strong>{' '}
              <span className="ds-field__hint">
                {t('ai.middle', { price: formatBaht(r.midMinor) })}
              </span>
            </p>
            <p className="ds-field__hint">{r.explanation}</p>
            <table className="ds-table" aria-label={t('ai.proceedsAria')}>
              <thead>
                <tr>
                  <th scope="col">{t('ai.col.ifSoldAt')}</th>
                  <th scope="col">{t('ai.col.price')}</th>
                  <th scope="col">{t('ai.col.fee')}</th>
                  <th scope="col">{t('ai.col.receive')}</th>
                  <th scope="col">{t('ai.col.overCosts')}</th>
                </tr>
              </thead>
              <tbody>
                {a.expectedProceeds.map((p) => (
                  <tr key={p.scenario}>
                    <th scope="row">{aiLabel(t, 'scenario', p.scenario)}</th>
                    <td>{formatBaht(p.priceMinor)}</td>
                    <td>{formatBaht(p.platformFeeMinor)}</td>
                    <td>{formatBaht(p.netProceedsMinor)}</td>
                    <td>
                      {p.netOverRecordedCostMinor === null
                        ? '—'
                        : formatBaht(p.netOverRecordedCostMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="ds-field__hint">{t('ai.feeNote')}</p>
          </>
        ) : (
          <p>{t('ai.noPrice')}</p>
        )}
        {a.priceBases.length > 0 && (
          <details>
            <summary>{t('ai.marketData')}</summary>
            <ul>
              {a.priceBases.map((b) => (
                <li key={b.source}>
                  {t('ai.observations', { label: b.label, count: b.sampleSize })}
                  {b.used ? t('ai.used') : b.note ? t('ai.notUsed', { note: b.note }) : ''}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      <div className="ds-grid ds-grid--2">
        <Card title={t('ai.costTitle')} headingLevel={2}>
          {c ? (
            <>
              <p style={{ margin: 0 }}>
                <strong>{formatBaht(c.recordedCostMinor)}</strong>{' '}
                {t('ai.fromRecords', { count: c.recordCount })}
                {c.recordedCostPerDayMinor
                  ? ` · ${t('ai.perDay', { price: formatBaht(c.recordedCostPerDayMinor), days: c.daysOnFarm ?? '—' })}`
                  : ''}
              </p>
              <ul>
                {c.byCategory.map((x) => (
                  <li key={x.category}>
                    {enumLabel(t, 'expenseCategory', x.category)}: {formatBaht(x.amountMinor)} (
                    {x.count})
                  </li>
                ))}
              </ul>
              {c.notes.map((n) => (
                <p className="ds-field__hint" key={n}>
                  {n}
                </p>
              ))}
            </>
          ) : (
            <p>{t('ai.costsHidden')}</p>
          )}
        </Card>
        <Card title={t('ai.growthHealthTitle')} headingLevel={2}>
          <p style={{ margin: 0 }}>
            {a.growth.weightCount === 0
              ? t('ai.noWeights')
              : a.growth.averageDailyGainG !== null
                ? t('ai.weightsWithGain', {
                    count: a.growth.weightCount,
                    kg: a.growth.latestKg ?? '',
                    date: fmt.date(a.growth.latestWeighedOn),
                    gain: a.growth.averageDailyGainG,
                  })
                : t('ai.weights', {
                    count: a.growth.weightCount,
                    kg: a.growth.latestKg ?? '',
                    date: fmt.date(a.growth.latestWeighedOn),
                  })}
          </p>
          {a.health ? (
            <p>
              {t('ai.healthSummary', {
                count: a.health.recordCount,
                illness: a.health.last90Days.illness,
                treatment: a.health.last90Days.treatment,
                vaccination: a.health.last90Days.vaccination,
              })}
              {a.health.withdrawalEndsOn
                ? ` ${t('ai.withdrawal', { date: fmt.date(a.health.withdrawalEndsOn) })}`
                : ''}
              <span className="ds-field__hint"> {a.health.note}</span>
            </p>
          ) : (
            <p className="ds-field__hint">{t('ai.healthNotConsidered')}</p>
          )}
        </Card>
      </div>

      {a.narrative.status === 'ok' && (
        <Card
          title={t('ai.explanationTitle')}
          headingLevel={2}
          style={{ marginTop: 'var(--ds-space-4)' }}
        >
          <Badge tone="info">{t('ai.generated')}</Badge>
          <p>{a.narrative.summary}</p>
          {a.narrative.observations.length > 0 && (
            <ul>
              {a.narrative.observations.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          )}
          {a.narrative.questionsForOwner.length > 0 && (
            <>
              <p className="ds-field__hint">{t('ai.questions')}</p>
              <ul>
                {a.narrative.questionsForOwner.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </>
          )}
          <p className="ds-field__hint">{a.narrative.label}</p>
        </Card>
      )}
      {a.narrative.status !== 'ok' && a.narrative.status !== 'not_requested' && (
        <p className="ds-field__hint">
          {t('ai.noExplanation', { reason: a.narrative.reason ?? '' })}
        </p>
      )}

      <Card title={t('ai.suggestions')} headingLevel={2} style={{ marginTop: 'var(--ds-space-4)' }}>
        <ul aria-label={t('ai.recommendationsAria')}>
          {a.recommendations.map((rec) => (
            <li key={rec.id} style={{ opacity: rec.dismissed ? 0.55 : 1 }}>
              {rec.text}{' '}
              {rec.dismissed ? (
                <span className="ds-field__hint">{t('ai.dismissed')}</span>
              ) : (
                canReview && (
                  <button
                    type="button"
                    className="ds-btn ds-btn--ghost ds-btn--sm"
                    onClick={() => void dismissRec(rec.id)}
                  >
                    {t('ai.dismiss')}
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
        <p>
          {t('ai.yourDecision')} <strong>{aiLabel(t, 'review', a.review.status)}</strong>
          {a.review.reviewedBy
            ? ` ${t('ai.reviewedBy', { name: a.review.reviewedBy.displayName, date: fmt.dateTime(a.review.reviewedAt) })}`
            : ''}
          {a.review.note ? ` — “${a.review.note}”` : ''}
        </p>
        {canReview && (
          <>
            {error && <Alert tone="danger">{error}</Alert>}
            <Textarea
              label={t('ai.note')}
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="ds-row">
              <Button onClick={() => void decide('accepted')}>{t('ai.markReviewed')}</Button>
              <Button onClick={() => void decide('dismissed')}>{t('ai.dismissAssessment')}</Button>
            </div>
            <p className="ds-field__hint">{t('ai.reviewNote')}</p>
          </>
        )}
      </Card>
      <p className="ds-field__hint">{a.disclaimer}</p>
    </div>
  );
}

function FactorTable({ factors }: { factors: ReadinessFactor[] }) {
  const t = useFarmsT();
  return (
    <table className="ds-table" aria-label={t('ai.factorsAria')}>
      <thead>
        <tr>
          <th scope="col">{t('ai.col.factor')}</th>
          <th scope="col">{t('animals.col.status')}</th>
          <th scope="col">{t('ai.col.measured')}</th>
          <th scope="col">{t('ai.col.compared')}</th>
        </tr>
      </thead>
      <tbody>
        {factors.map((f) => (
          <tr key={f.key}>
            <th scope="row">
              {f.label}
              <div className="ds-field__hint">{f.detail}</div>
            </th>
            <td>
              <Badge tone={STATUS_TONE[f.status]}>{t(STATUS_TEXT[f.status])}</Badge>
              <div className="ds-field__hint">
                {f.basis === 'configured_criteria' ? t('ai.configuredRule') : t('ai.recordedData')}
              </div>
            </td>
            <td>{f.value ?? '—'}</td>
            <td>{f.threshold ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
