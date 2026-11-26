import { useEffect, useState, type FormEvent } from 'react';
import type { CommissionRuleDTO, FeeSnapshot } from '@farmplus/shared-types';
import { formatBaht, parseBahtToMinor } from '@farmplus/shared-utils';
import { createCommissionRuleSchema, updateCommissionRuleSchema } from '@farmplus/validation';
import { api } from '../../../api';
import { StateMessage } from '../../../components/admin';
import { rich, useAdminI18n } from '../../../components/admin/i18n';
import { errorMessage, toDateTimeLocal } from '../../../lib/format';
import { Tag, range } from '../finance-common';

interface Form {
  name: string;
  feePercent: string;
  minFee: string;
  maxFee: string;
  priceMin: string;
  priceMax: string;
  categories: string;
  startsAt: string;
  endsAt: string;
  priority: string;
  reason: string;
}
const EMPTY: Form = {
  name: '',
  feePercent: '',
  minFee: '',
  maxFee: '',
  priceMin: '',
  priceMax: '',
  categories: '',
  startsAt: toDateTimeLocal(new Date()),
  endsAt: '',
  priority: '10',
  reason: '',
};

// Fee and price bounds may be 0 (e.g. no minimum fee); the API accepts it.
const money = (v: string): number | null | undefined =>
  v.trim() === '' ? null : v.trim() === '0' ? 0 : parseBahtToMinor(v);
const percentToBps = (v: string): number | undefined => {
  const n = Number(v);
  return v.trim() !== '' && Number.isFinite(n) ? Math.round(n * 100) : undefined;
};
/** The API names fields differently from the form (percent vs bps, baht vs satang). */
const FORM_FIELD: Record<string, string> = {
  feeBps: 'feePercent',
  minFeeMinor: 'minFee',
  maxFeeMinor: 'maxFee',
  priceMinMinor: 'priceMin',
  priceMaxMinor: 'priceMax',
};
const remap = (errors: Record<string, string>) =>
  Object.fromEntries(Object.entries(errors).map(([k, v]) => [FORM_FIELD[k] ?? k, v]));
const iso = (local: string) => (local ? new Date(local).toISOString() : undefined);

/** `/admin/commissions` — platform fee rules. The fee in force at checkout is frozen on each order. */
export default function CommissionsPage() {
  const i18n = useAdminI18n();
  const { t, dateTime } = i18n;
  const [rules, setRules] = useState<CommissionRuleDTO[]>();
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<CommissionRuleDTO | 'new' | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    api
      .request<{ rules: CommissionRuleDTO[] }>('GET', '/admin/finance/commission-rules')
      .then((r) => live && setRules(r.rules))
      .catch((e: unknown) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [version]);
  const reload = () => setVersion((v) => v + 1);

  return (
    <>
      <h1>{t('commissions.title')}</h1>
      <p className="adm-muted">
        {rich(t('commissions.intro'), {
          highest: <strong>{t('commissions.highest')}</strong>,
          setting: (
            <>
              {t('commissions.settingName')}{' '}
              <small>
                (<code>orders.platformFeeBps</code>)
              </small>
            </>
          ),
        })}
      </p>
      {error && <StateMessage kind="error">{error}</StateMessage>}
      {!rules && !error && <StateMessage kind="loading" />}
      {rules && (
        <div className="adm-table-scroll">
          <table className="adm-table" aria-label={t('commissions.title')}>
            <thead>
              <tr>
                <th scope="col">{t('common.name')}</th>
                <th scope="col">{t('commissions.fee')}</th>
                <th scope="col">{t('commissions.bounds')}</th>
                <th scope="col">{t('commissions.priceRange')}</th>
                <th scope="col">{t('commissions.categories')}</th>
                <th scope="col">{t('commissions.effective')}</th>
                <th scope="col">{t('commissions.priority')}</th>
                <th scope="col">{t('common.state')}</th>
                <th scope="col">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.name} <small>v{r.version}</small>
                  </td>
                  <td>{(r.feeBps / 100).toFixed(2)}%</td>
                  <td>{range(i18n, r.minFeeMinor, r.maxFeeMinor)}</td>
                  <td>{range(i18n, r.priceMinMinor, r.priceMaxMinor)}</td>
                  <td>{r.categories.length ? r.categories.join(', ') : t('common.all')}</td>
                  <td>
                    {dateTime(r.startsAt)} →{' '}
                    {r.endsAt ? dateTime(r.endsAt) : t('commissions.openEnded')}
                  </td>
                  <td>{r.priority}</td>
                  <td>
                    <Tag value={r.active ? 'active' : 'inactive'} />
                  </td>
                  <td>
                    <button type="button" className="adm-btn" onClick={() => setEditing(r)}>
                      {t('common.edit')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rules && rules.length === 0 && (
        <StateMessage kind="empty">{t('commissions.empty')}</StateMessage>
      )}
      <p>
        <button
          type="button"
          className="adm-btn adm-btn--primary"
          onClick={() => setEditing('new')}
        >
          {t('commissions.newRule')}
        </button>
      </p>
      {editing && (
        <RuleForm
          key={editing === 'new' ? 'new' : editing.id}
          rule={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      <Preview />
    </>
  );
}

function RuleForm({
  rule,
  onClose,
  onSaved,
}: {
  rule: CommissionRuleDTO | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState<Form>(
    rule
      ? {
          name: rule.name,
          feePercent: String(rule.feeBps / 100),
          minFee: rule.minFeeMinor == null ? '' : String(rule.minFeeMinor / 100),
          maxFee: rule.maxFeeMinor == null ? '' : String(rule.maxFeeMinor / 100),
          priceMin: rule.priceMinMinor == null ? '' : String(rule.priceMinMinor / 100),
          priceMax: rule.priceMaxMinor == null ? '' : String(rule.priceMaxMinor / 100),
          categories: rule.categories.join(', '),
          startsAt: toDateTimeLocal(rule.startsAt),
          endsAt: rule.endsAt ? toDateTimeLocal(rule.endsAt) : '',
          priority: String(rule.priority),
          reason: '',
        }
      : EMPTY,
  );
  const { t, validation } = useAdminI18n();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Form, v: string) => setF((x) => ({ ...x, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const bad: Record<string, string> = {};
    const [minFee, maxFee, priceMin, priceMax] = [
      money(f.minFee),
      money(f.maxFee),
      money(f.priceMin),
      money(f.priceMax),
    ];
    if (minFee === undefined) bad['minFeeMinor'] = t('commissions.errFee');
    if (maxFee === undefined) bad['maxFeeMinor'] = t('commissions.errFee');
    if (priceMin === undefined) bad['priceMinMinor'] = t('commissions.errAmount');
    if (priceMax === undefined) bad['priceMaxMinor'] = t('commissions.errAmount');
    const feeBps = percentToBps(f.feePercent);
    if (feeBps === undefined) bad['feeBps'] = t('commissions.errPercent');
    if (Object.keys(bad).length) return setErrors(remap(bad));
    const body = {
      name: f.name,
      feeBps: feeBps!,
      minFeeMinor: minFee ?? null,
      maxFeeMinor: maxFee ?? null,
      priceMinMinor: priceMin ?? null,
      priceMaxMinor: priceMax ?? null,
      categories: f.categories
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
      startsAt: iso(f.startsAt) ?? '',
      endsAt: iso(f.endsAt) ?? null,
      priority: Number(f.priority),
      reason: f.reason,
    };
    const parsed = (rule ? updateCommissionRuleSchema : createCommissionRuleSchema).safeParse(body);
    if (!parsed.success)
      return setErrors(
        Object.fromEntries(
          parsed.error.issues.map((i) => [String(i.path[0] ?? '_form'), validation(i.message)]),
        ),
      );
    setBusy(true);
    setErrors({});
    try {
      if (rule)
        await api.request('PATCH', `/admin/finance/commission-rules/${rule.id}`, {
          body: parsed.data,
        });
      else await api.request('POST', '/admin/finance/commission-rules', { body: parsed.data });
      onSaved();
    } catch (err) {
      setErrors({ _form: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  const deactivate = async () => {
    if (!rule) return;
    if (f.reason.trim().length < 3) return setErrors({ reason: t('commissions.errReason') });
    setBusy(true);
    try {
      await api.request('PATCH', `/admin/finance/commission-rules/${rule.id}`, {
        body: { active: !rule.active, reason: f.reason.trim() },
      });
      onSaved();
    } catch (err) {
      setErrors({ _form: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const field = (k: keyof Form, label: string, type = 'text', hint?: string) => (
    <label className="adm-field">
      <span>{label}</span>
      <input
        type={type}
        value={f[k]}
        onChange={(e) => set(k, e.target.value)}
        aria-invalid={errors[k] ? true : undefined}
      />
      {hint && <small className="adm-muted">{hint}</small>}
      {errors[k] && <small className="adm-error">{errors[k]}</small>}
    </label>
  );

  return (
    <form
      className="adm-card adm-form"
      onSubmit={submit}
      noValidate
      aria-label={rule ? t('commissions.editAria') : t('commissions.newTitle')}
    >
      <h2 style={{ marginTop: 0 }}>
        {rule ? t('commissions.editTitle', { name: rule.name }) : t('commissions.newTitle')}
      </h2>
      {errors['_form'] && (
        <p className="adm-error" role="alert">
          {errors['_form']}
        </p>
      )}
      {field('name', t('common.name'))}
      {field('feePercent', t('commissions.feePercent'), 'text', t('commissions.feeHint'))}
      {field('minFee', t('commissions.minFee'))}
      {field('maxFee', t('commissions.maxFee'))}
      {field('priceMin', t('commissions.priceMin'))}
      {field('priceMax', t('commissions.priceMax'))}
      {field(
        'categories',
        t('commissions.categoriesField'),
        'text',
        t('commissions.categoriesHint'),
      )}
      {field('startsAt', t('commissions.startsAt'), 'datetime-local')}
      {field('endsAt', t('commissions.endsAt'), 'datetime-local')}
      {field('priority', t('commissions.priorityField'), 'number')}
      {field('reason', t('commissions.reasonField'), 'text', t('commissions.reasonHint'))}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="submit" className="adm-btn adm-btn--primary" disabled={busy}>
          {busy ? t('common.saving') : t('commissions.save')}
        </button>
        {rule && (
          <button
            type="button"
            className={`adm-btn ${rule.active ? 'adm-btn--danger' : ''}`}
            disabled={busy}
            onClick={() => void deactivate()}
          >
            {rule.active ? t('action.deactivate') : t('action.reactivate')}
          </button>
        )}
        <button type="button" className="adm-btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

function Preview() {
  const { t } = useAdminI18n();
  const [price, setPrice] = useState('40000');
  const [category, setCategory] = useState('buffalo');
  const [fee, setFee] = useState<FeeSnapshot>();
  const [error, setError] = useState<string>();

  const run = async (e: FormEvent) => {
    e.preventDefault();
    const minor = parseBahtToMinor(price);
    if (!minor) return setError(t('commissions.errPrice'));
    setError(undefined);
    try {
      const r = await api.request<{ fee: FeeSnapshot }>(
        'POST',
        '/admin/finance/commission-rules/preview',
        {
          body: { priceMinor: minor, ...(category.trim() ? { categoryKey: category.trim() } : {}) },
        },
      );
      setFee(r.fee);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <form className="adm-card adm-form" onSubmit={run} aria-label={t('commissions.previewAria')}>
      <h2 style={{ marginTop: 0 }}>{t('commissions.previewTitle')}</h2>
      <label className="adm-field">
        <span>{t('commissions.itemPrice')}</span>
        <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
      </label>
      <label className="adm-field">
        <span>{t('ai.animalTypeKey')}</span>
        <input value={category} onChange={(e) => setCategory(e.target.value)} />
      </label>
      <button type="submit" className="adm-btn">
        {t('commissions.calculate')}
      </button>
      {error && (
        <p className="adm-error" role="alert">
          {error}
        </p>
      )}
      {fee && (
        <p role="status">
          {rich(
            t('commissions.previewResult', {
              bps: (fee.feeBps / 100).toFixed(2),
              raw: formatBaht(fee.rawFeeMinor),
              clamp:
                fee.clamp === 'base'
                  ? t('commissions.clampBase')
                  : fee.clamp === 'min'
                    ? t('commissions.clampMin')
                    : fee.clamp === 'max'
                      ? t('commissions.clampMax')
                      : '',
              source:
                fee.source === 'rule'
                  ? t('commissions.sourceRule', { name: fee.ruleName ?? '' })
                  : t('commissions.sourceDefault'),
              net: formatBaht(fee.baseMinor - fee.feeMinor),
            }),
            { fee: <strong>{formatBaht(fee.feeMinor)}</strong> },
          )}
        </p>
      )}
    </form>
  );
}
