import { useState, type FormEvent } from 'react';
import type { AiUsageSummary, CriteriaDTO, MarketPointDTO, Page } from '@farmplus/shared-types';
import { formatBaht } from '@farmplus/shared-utils';
import { createCriteriaSchema, createMarketPointSchema } from '@farmplus/validation';
import { api } from '../../../api';
import { StateMessage } from '../../../components/admin';
import { cap, rich, useAdminI18n } from '../../../components/admin/i18n';
import { errorMessage } from '../../../lib/format';
import { useAsync } from '../../../lib/useAsync';

/** `/admin/ai` — usage and cost monitoring, readiness criteria and authorised market data for AI assessments. */
export default function AiAdminPage() {
  const { t } = useAdminI18n();
  return (
    <>
      <h1>{t('nav.ai')}</h1>
      <p className="adm-muted">{t('ai.intro')}</p>
      <Usage />
      <Criteria />
      <Market />
    </>
  );
}

const micros = (m: number) => formatBaht(Math.round(m / 10_000));

function Usage() {
  const { t, number } = useAdminI18n();
  const [days, setDays] = useState(30);
  const usage = useAsync(
    (signal) =>
      api.request<{ usage: AiUsageSummary }>('GET', '/admin/ai/usage', { signal, query: { days } }),
    [days],
  );
  const u = usage.data?.usage;
  return (
    <section className="adm-card" aria-label={t('ai.usageAria')}>
      <h2 style={{ marginTop: 0 }}>{t('ai.usageTitle')}</h2>
      <label className="adm-field" style={{ maxWidth: '12rem' }}>
        <span>{t('ai.period')}</span>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[7, 30, 90].map((d) => (
            <option key={d} value={d}>
              {t('ai.lastDays', { days: d })}
            </option>
          ))}
        </select>
      </label>
      {usage.error && <StateMessage kind="error">{usage.error}</StateMessage>}
      {u && (
        <>
          <p>
            {rich(
              t('ai.provider', {
                note: u.configured ? '' : t('ai.notConfigured'),
                used: u.budget.usedToday,
                limit: u.budget.dailyLimit,
              }),
              {
                provider: (
                  <strong>{u.provider === 'none' ? t('ai.providerNone') : u.provider}</strong>
                ),
              },
            )}
          </p>
          <dl className="adm-dl">
            <dt>{t('ai.calls')}</dt>
            <dd>
              {t('ai.callsValue', {
                calls: u.totals.calls,
                ok: u.totals.ok,
                errors: u.totals.errors,
                rejected: u.totals.rejected,
                skipped: u.totals.skipped,
              })}
            </dd>
            <dt>{t('ai.errorRate')}</dt>
            <dd>
              {u.totals.errorRate === null
                ? '—'
                : t('ai.errorRateValue', { rate: (u.totals.errorRate * 100).toFixed(1) })}
            </dd>
            <dt>{t('ai.tokens')}</dt>
            <dd>
              {t('ai.tokensValue', {
                input: number(u.totals.inputTokens),
                output: number(u.totals.outputTokens),
              })}
            </dd>
            <dt>{t('ai.cost')}</dt>
            <dd>
              {u.costRatesConfigured ? micros(u.totals.estimatedCostMicros) : t('ai.costUnset')}
            </dd>
            <dt>{t('ai.p95')}</dt>
            <dd>
              {u.totals.p95LatencyMs === null ? '—' : t('ai.ms', { ms: u.totals.p95LatencyMs })}
            </dd>
          </dl>
          {u.byErrorCode.length > 0 && (
            <p>
              {t('ai.problems')}{' '}
              {u.byErrorCode.map((c) => (
                <span
                  key={c.code}
                  className="adm-badge adm-badge--warning"
                  style={{ marginRight: '0.5rem' }}
                >
                  {c.code} × {c.count}
                </span>
              ))}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Criteria() {
  const { t, label, dateTime, validation } = useAdminI18n();
  const [version, setVersion] = useState(0);
  const list = useAsync(
    (signal) => api.request<{ criteria: CriteriaDTO[] }>('GET', '/admin/ai/criteria', { signal }),
    [version],
  );
  const [f, setF] = useState({
    animalTypeKey: '',
    minAgeDays: '',
    minWeightKg: '',
    minAverageDailyGainG: '',
    weightFreshDays: '',
    healthClearDays: '',
    source: '',
    validated: false,
    validationReference: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const num = (v: string) => (v.trim() ? Number(v) : null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      animalTypeKey: f.animalTypeKey.trim(),
      rules: {
        minAgeDays: num(f.minAgeDays),
        minWeightKg: num(f.minWeightKg),
        minAverageDailyGainG: num(f.minAverageDailyGainG),
        weightFreshDays: num(f.weightFreshDays),
        healthClearDays: num(f.healthClearDays),
      },
      source: f.source,
      validated: f.validated,
      ...(f.validationReference.trim()
        ? { validationReference: f.validationReference.trim() }
        : {}),
    };
    const parsed = createCriteriaSchema.safeParse(body);
    if (!parsed.success)
      return setErrors(
        Object.fromEntries(
          parsed.error.issues.map((i) => [String(i.path.at(-1) ?? '_form'), validation(i.message)]),
        ),
      );
    setErrors({});
    try {
      await api.request('POST', '/admin/ai/criteria', { body: parsed.data });
      setVersion((v) => v + 1);
    } catch (err) {
      setErrors({ _form: errorMessage(err) });
    }
  };
  const field = (k: keyof typeof f, label: string, hint?: string) => (
    <label className="adm-field">
      <span>{label}</span>
      <input value={String(f[k])} onChange={(e) => set(k, e.target.value)} />
      {hint && <small className="adm-muted">{hint}</small>}
      {errors[k] && <small className="adm-error">{errors[k]}</small>}
    </label>
  );
  return (
    <section className="adm-card" aria-label={t('ai.criteriaAria')} style={{ marginTop: '1.5rem' }}>
      <h2 style={{ marginTop: 0 }}>{t('ai.criteriaTitle')}</h2>
      <p className="adm-muted">
        {rich(t('ai.criteriaIntro'), { score: <em>{t('ai.score')}</em> })}
      </p>
      {list.error && <StateMessage kind="error">{list.error}</StateMessage>}
      <div className="adm-table-scroll">
        <table className="adm-table" aria-label={t('ai.criteriaTable')}>
          <thead>
            <tr>
              <th scope="col">{t('ai.animalType')}</th>
              <th scope="col">{t('ai.version')}</th>
              <th scope="col">{t('ai.rules')}</th>
              <th scope="col">{t('ai.source')}</th>
              <th scope="col">{t('ai.validated')}</th>
              <th scope="col">{t('common.state')}</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.criteria.map((c) => (
              <tr key={c.id}>
                <td>{c.animalTypeName}</td>
                <td>v{c.version}</td>
                <td>
                  {Object.entries(c.rules)
                    .filter(([, v]) => v !== null && v !== undefined)
                    .map(
                      ([k, v]) =>
                        `${cap(label('aiRule', k, k.replace(/([A-Z])/g, ' $1').toLowerCase()))}: ${typeof v === 'object' ? JSON.stringify(v) : v}`,
                    )
                    .join(' · ')}
                </td>
                <td>{c.source}</td>
                <td>
                  {c.validated
                    ? t('ai.yesRef', { ref: c.validationReference ?? '' })
                    : t('common.no')}
                </td>
                <td>
                  <span className={`adm-badge adm-badge--${c.active ? 'success' : 'neutral'}`}>
                    {c.active ? t('ai.active') : t('ai.superseded')}
                  </span>{' '}
                  {dateTime(c.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="adm-form" onSubmit={submit} noValidate aria-label={t('ai.newCriteriaAria')}>
        <h3>{t('ai.newVersion')}</h3>
        {errors['_form'] && (
          <p className="adm-error" role="alert">
            {errors['_form']}
          </p>
        )}
        {field('animalTypeKey', t('ai.animalTypeKey'), t('ai.animalTypeHint'))}
        {field('minAgeDays', t('ai.minAge'))}
        {field('minWeightKg', t('ai.minWeight'))}
        {field('minAverageDailyGainG', t('ai.minGain'))}
        {field('weightFreshDays', t('ai.weightFresh'))}
        {field('healthClearDays', t('ai.healthClear'))}
        {field('source', t('ai.sourceQuestion'), t('ai.sourceHint'))}
        <label className="adm-check">
          <input
            type="checkbox"
            checked={f.validated}
            onChange={(e) => set('validated', e.target.checked)}
          />
          <span>{t('ai.validatedCheck')}</span>
        </label>
        {f.validated && field('validationReference', t('ai.validationRef'))}
        <button type="submit" className="adm-btn adm-btn--primary">
          {t('ai.saveVersion')}
        </button>
      </form>
    </section>
  );
}

function Market() {
  const { t, validation } = useAdminI18n();
  const [version, setVersion] = useState(0);
  const list = useAsync(
    (signal) =>
      api.request<Page<MarketPointDTO>>('GET', '/admin/ai/market-data', {
        signal,
        query: { pageSize: 20 },
      }),
    [version],
  );
  const [f, setF] = useState({
    animalTypeKey: '',
    kind: 'per_head',
    price: '',
    observedOn: '',
    source: '',
    authorization: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const baht = Number(f.price);
    const parsed = createMarketPointSchema.safeParse({
      animalTypeKey: f.animalTypeKey.trim(),
      kind: f.kind,
      priceMinor: Number.isFinite(baht) ? Math.round(baht * 100) : NaN,
      observedOn: f.observedOn,
      source: f.source,
      authorization: f.authorization,
    });
    if (!parsed.success)
      return setErrors(
        Object.fromEntries(
          parsed.error.issues.map((i) => [String(i.path[0] ?? '_form'), validation(i.message)]),
        ),
      );
    setErrors({});
    try {
      await api.request('POST', '/admin/ai/market-data', { body: parsed.data });
      setVersion((v) => v + 1);
    } catch (err) {
      setErrors({ _form: errorMessage(err) });
    }
  };
  const field = (k: keyof typeof f, label: string, hint?: string, type = 'text') => (
    <label className="adm-field">
      <span>{label}</span>
      <input type={type} value={f[k]} onChange={(e) => set(k, e.target.value)} />
      {hint && <small className="adm-muted">{hint}</small>}
      {errors[k === 'price' ? 'priceMinor' : k] && (
        <small className="adm-error">{errors[k === 'price' ? 'priceMinor' : k]}</small>
      )}
    </label>
  );
  return (
    <section className="adm-card" aria-label={t('ai.marketAria')} style={{ marginTop: '1.5rem' }}>
      <h2 style={{ marginTop: 0 }}>{t('ai.marketTitle')}</h2>
      <p className="adm-muted">{t('ai.marketIntro')}</p>
      <div className="adm-table-scroll">
        <table className="adm-table" aria-label={t('ai.pricesTable')}>
          <thead>
            <tr>
              <th scope="col">{t('common.type')}</th>
              <th scope="col">{t('ai.price')}</th>
              <th scope="col">{t('ai.observed')}</th>
              <th scope="col">{t('ai.source')}</th>
              <th scope="col">{t('ai.authorisation')}</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.items.map((p) => (
              <tr key={p.id}>
                <td>{p.animalTypeKey}</td>
                <td>
                  {formatBaht(p.priceMinor)}{' '}
                  {p.kind === 'per_kg' ? t('ai.perKgUnit') : t('ai.perHeadUnit')}
                </td>
                <td>{p.observedOn}</td>
                <td>{p.source}</td>
                <td>{p.authorization}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="adm-form" onSubmit={submit} noValidate aria-label={t('ai.importAria')}>
        <h3>{t('ai.addObservation')}</h3>
        {errors['_form'] && (
          <p className="adm-error" role="alert">
            {errors['_form']}
          </p>
        )}
        {field('animalTypeKey', t('ai.animalTypeKey'))}
        <label className="adm-field">
          <span>{t('ai.priceIs')}</span>
          <select value={f.kind} onChange={(e) => set('kind', e.target.value)}>
            <option value="per_head">{t('ai.perHead')}</option>
            <option value="per_kg">{t('ai.perKg')}</option>
          </select>
        </label>
        {field('price', t('ai.priceBaht'))}
        {field('observedOn', t('ai.observedOn'), undefined, 'date')}
        {field('source', t('ai.source'))}
        {field('authorization', t('ai.authQuestion'), t('ai.authHint'))}
        <button type="submit" className="adm-btn adm-btn--primary">
          {t('ai.addPrice')}
        </button>
      </form>
    </section>
  );
}
