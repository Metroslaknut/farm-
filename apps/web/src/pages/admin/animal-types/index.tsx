import { useEffect, useState, type FormEvent } from 'react';
import { REPRODUCTION_MODES, type AnimalTypeSummary } from '@farmplus/shared-types';
import {
  addBreedGroupSchema,
  addBreedSchema,
  addRearingTypeSchema,
  createAnimalTypeSchema,
  updateAnimalTypeSchema,
  updateBreedSchema,
} from '@farmplus/validation';
import { api } from '../../../api';
import { StateMessage } from '../../../components/admin';
import { useAdminI18n } from '../../../components/admin/i18n';
import { errorMessage } from '../../../lib/format';
import { Tag } from '../finance-common';

type Errors = Record<string, string>;
const CONFIG = ['gestationDays', 'minBreedingAgeDays', 'maxWeightKg'] as const;
type ConfigKey = (typeof CONFIG)[number];

/** Empty → `undefined` (create) or `null` (update: clear the value); otherwise a number (NaN fails validation). */
const num = (v: string, clear: null | undefined) => (v.trim() === '' ? clear : Number(v));

function issuesToErrors(
  issues: { path: PropertyKey[]; message: string }[],
  validation: (m: string) => string,
): Errors {
  return Object.fromEntries(
    issues.map((i) => [String(i.path[0] ?? '_form'), validation(i.message)]),
  );
}

/** `/admin/animal-types` — the species catalogue (API: `/animal-types`, permission `animal_types.manage`). */
export default function AnimalTypesPage() {
  const { t, status } = useAdminI18n();
  const [types, setTypes] = useState<AnimalTypeSummary[]>();
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<AnimalTypeSummary | 'new' | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    api
      .request<{ animalTypes: AnimalTypeSummary[] }>('GET', '/animal-types', {
        query: { includeInactive: 'true' },
      })
      .then((r) => {
        if (!live) return;
        setTypes(r.animalTypes);
        // Keep the open editor in sync with the reloaded data (e.g. after adding a breed).
        setEditing((e) =>
          e && e !== 'new' ? (r.animalTypes.find((x) => x.id === e.id) ?? null) : e,
        );
      })
      .catch((e: unknown) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [version]);
  const reload = () => setVersion((v) => v + 1);

  return (
    <>
      <h1>{t('species.title')}</h1>
      <p className="adm-muted">{t('species.intro')}</p>
      {error && <StateMessage kind="error">{error}</StateMessage>}
      {!types && !error && <StateMessage kind="loading" />}
      {types && types.length === 0 && (
        <StateMessage kind="empty">{t('species.empty')}</StateMessage>
      )}
      {types && types.length > 0 && (
        <div className="adm-table-scroll">
          <table className="adm-table" aria-label={t('species.title')}>
            <thead>
              <tr>
                <th scope="col">{t('common.name')}</th>
                <th scope="col">{t('species.key')}</th>
                <th scope="col">{t('species.breeds')}</th>
                <th scope="col">{t('species.config')}</th>
                <th scope="col">{t('common.state')}</th>
                <th scope="col">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {types.map((type) => (
                <tr key={type.id}>
                  <td>
                    {type.name}
                    {type.nameTh && <small className="adm-muted"> · {type.nameTh}</small>}
                  </td>
                  <td>
                    <code>{type.key}</code>
                  </td>
                  <td>
                    {type.breeds.length
                      ? type.breeds
                          .slice(0, 10)
                          .map((b) => (b.active ? b.name : `${b.name} (${status('inactive')})`))
                          .join(', ') +
                        (type.breeds.length > 10
                          ? ` ${t('species.andMore', { n: type.breeds.length - 10 })}`
                          : '')
                      : '—'}
                  </td>
                  <td>
                    {CONFIG.filter((k) => type[k] !== undefined)
                      .map((k) => `${t(`species.${k}`)}: ${type[k]}`)
                      .join(' · ') || '—'}
                  </td>
                  <td>
                    <Tag value={type.status} />
                  </td>
                  <td>
                    <button type="button" className="adm-btn" onClick={() => setEditing(type)}>
                      {t('common.edit')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p>
        <button
          type="button"
          className="adm-btn adm-btn--primary"
          onClick={() => setEditing('new')}
        >
          {t('species.new')}
        </button>
      </p>
      {editing && (
        <TypeForm
          key={editing === 'new' ? 'new' : editing.id}
          type={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(close) => {
            if (close) setEditing(null);
            reload();
          }}
        />
      )}
    </>
  );
}

function TypeForm({
  type,
  onClose,
  onSaved,
}: {
  type: AnimalTypeSummary | null;
  onClose: () => void;
  onSaved: (close: boolean) => void;
}) {
  const { t, validation } = useAdminI18n();
  const [f, setF] = useState({
    key: '',
    name: type?.name ?? '',
    nameTh: type?.nameTh ?? '',
    reproduction: type?.reproduction ?? 'live_birth',
    ...(Object.fromEntries(
      CONFIG.map((k) => [k, type?.[k] === undefined ? '' : String(type[k])]),
    ) as Record<ConfigKey, string>),
  });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const run = async (call: () => Promise<unknown>, close: boolean) => {
    setBusy(true);
    setErrors({});
    try {
      await call();
      onSaved(close);
    } catch (err) {
      setErrors({ _form: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const clear = type ? null : undefined;
    const body = {
      ...(type ? {} : { key: f.key.trim() }),
      name: f.name.trim(),
      nameTh: f.nameTh.trim() || clear,
      // Only sent when it differs from what is stored (new types default to live birth).
      ...(f.reproduction !== (type?.reproduction ?? 'live_birth')
        ? { reproduction: f.reproduction }
        : {}),
      ...Object.fromEntries(CONFIG.map((k) => [k, num(f[k], clear)])),
    };
    const parsed = (type ? updateAnimalTypeSchema : createAnimalTypeSchema).safeParse(body);
    if (!parsed.success) return setErrors(issuesToErrors(parsed.error.issues, validation));
    await run(
      () =>
        type
          ? api.request('PATCH', `/animal-types/${type.id}`, { body: parsed.data })
          : api.request('POST', '/animal-types', { body: parsed.data }),
      true,
    );
  };

  const field = (k: keyof typeof f, label: string, hint?: string, inputMode?: 'numeric') => (
    <label className="adm-field">
      <span>{label}</span>
      <input
        value={f[k]}
        inputMode={inputMode}
        onChange={(e) => set(k, e.target.value)}
        aria-invalid={errors[k] ? true : undefined}
      />
      {hint && <small className="adm-muted">{hint}</small>}
      {errors[k] && <small className="adm-error">{errors[k]}</small>}
    </label>
  );

  return (
    <div className="adm-card adm-form">
      <form
        onSubmit={submit}
        noValidate
        aria-label={type ? t('species.editTitle', { name: type.name }) : t('species.new')}
      >
        <h2 style={{ marginTop: 0 }}>
          {type ? t('species.editTitle', { name: type.name }) : t('species.new')}
        </h2>
        {errors['_form'] && (
          <p className="adm-error" role="alert">
            {errors['_form']}
          </p>
        )}
        {!type && field('key', t('species.key'), t('species.keyHint'))}
        {field('name', t('common.name'))}
        {field('nameTh', t('species.nameTh'))}
        <label className="adm-field">
          <span>{t('species.reproduction')}</span>
          <select value={f.reproduction} onChange={(e) => set('reproduction', e.target.value)}>
            {REPRODUCTION_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`species.reproduction.${m}`)}
              </option>
            ))}
          </select>
          <small className="adm-muted">{t('species.reproductionHint')}</small>
        </label>
        {CONFIG.map((k) => (
          <div key={k}>{field(k, t(`species.${k}`), t('species.configHint'), 'numeric')}</div>
        ))}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="submit" className="adm-btn adm-btn--primary" disabled={busy}>
            {busy ? t('common.saving') : t('species.save')}
          </button>
          {type && (
            <button
              type="button"
              className={`adm-btn ${type.status === 'active' ? 'adm-btn--danger' : ''}`}
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    api.request('PATCH', `/animal-types/${type.id}`, {
                      body: { status: type.status === 'active' ? 'inactive' : 'active' },
                    }),
                  true,
                )
              }
            >
              {type.status === 'active' ? t('action.deactivate') : t('action.reactivate')}
            </button>
          )}
          <button type="button" className="adm-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
      {type && <Catalogue type={type} onChanged={() => onSaved(false)} />}
      {type && <Breeds type={type} onChanged={() => onSaved(false)} />}
    </div>
  );
}

function Breeds({ type, onChanged }: { type: AnimalTypeSummary; onChanged: () => void }) {
  const { t, validation } = useAdminI18n();
  const [f, setF] = useState({ key: '', name: '', nameTh: '', groupKey: '', composition: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const groupName = (key: string | undefined) =>
    (type.breedGroups ?? []).find((g) => g.key === key)?.name ?? key ?? '';

  const call = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErrors({});
    try {
      await fn();
      onChanged();
      return true;
    } catch (err) {
      setErrors({ _form: errorMessage(err) });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const composition = f.composition
      .split(/[,+]/)
      .map((x) => x.trim())
      .filter(Boolean);
    const parsed = addBreedSchema.safeParse({
      key: f.key.trim(),
      name: f.name.trim(),
      ...(f.nameTh.trim() ? { nameTh: f.nameTh.trim() } : {}),
      ...(f.groupKey ? { groupKey: f.groupKey } : {}),
      ...(composition.length ? { composition } : {}),
    });
    if (!parsed.success) return setErrors(issuesToErrors(parsed.error.issues, validation));
    if (
      await call(() =>
        api.request('POST', `/animal-types/${type.id}/breeds`, { body: parsed.data }),
      )
    )
      setF({ key: '', name: '', nameTh: '', groupKey: '', composition: '' });
  };
  const patch = (key: string, change: Record<string, unknown>) => {
    const body = updateBreedSchema.parse(change);
    void call(() => api.request('PATCH', `/animal-types/${type.id}/breeds/${key}`, { body }));
  };
  const toggle = (key: string, active: boolean) => patch(key, { active });

  return (
    <section aria-label={t('species.breeds')}>
      <h3>{t('species.breeds')}</h3>
      {errors['_form'] && (
        <p className="adm-error" role="alert">
          {errors['_form']}
        </p>
      )}
      <ul>
        {type.breeds.map((b) => (
          <li key={b.key}>
            {b.name}
            {b.nameTh && ` · ${b.nameTh}`} <code>{b.key}</code>{' '}
            {b.groupKey && <small className="adm-muted">[{groupName(b.groupKey)}]</small>}{' '}
            {b.composition && (
              <small className="adm-muted">
                {t('species.composition')}: {b.composition.join(' + ')}
              </small>
            )}{' '}
            <Tag value={b.active ? 'active' : 'inactive'} />{' '}
            {(type.breedGroups ?? []).length > 0 && (
              <select
                aria-label={t('species.breedGroupOf', { name: b.name })}
                value={b.groupKey ?? ''}
                disabled={busy}
                onChange={(e) => patch(b.key, { groupKey: e.target.value || null })}
              >
                <option value="">{t('species.noGroup')}</option>
                {(type.breedGroups ?? []).map((g) => (
                  <option key={g.key} value={g.key}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}{' '}
            <button
              type="button"
              className="adm-btn"
              disabled={busy}
              onClick={() => toggle(b.key, !b.active)}
            >
              {b.active ? t('action.deactivate') : t('action.reactivate')}
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} noValidate aria-label={t('species.addBreed')} className="adm-filters">
        {(['key', 'name', 'nameTh'] as const).map((k) => (
          <label key={k} className="adm-field">
            <span>
              {k === 'key'
                ? t('species.key')
                : k === 'name'
                  ? t('common.name')
                  : t('species.nameTh')}
            </span>
            <input
              value={f[k]}
              onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))}
              aria-invalid={errors[k] ? true : undefined}
            />
            {errors[k] && <small className="adm-error">{errors[k]}</small>}
          </label>
        ))}
        {(type.breedGroups ?? []).length > 0 && (
          <label className="adm-field">
            <span>{t('species.breedGroup')}</span>
            <select
              value={f.groupKey}
              onChange={(e) => setF((x) => ({ ...x, groupKey: e.target.value }))}
            >
              <option value="">{t('species.noGroup')}</option>
              {(type.breedGroups ?? []).map((g) => (
                <option key={g.key} value={g.key}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="adm-field">
          <span>{t('species.composition')}</span>
          <input
            value={f.composition}
            placeholder="burmese + thai"
            onChange={(e) => setF((x) => ({ ...x, composition: e.target.value }))}
            aria-invalid={errors['composition'] ? true : undefined}
          />
          <small className="adm-muted">{t('species.compositionHint')}</small>
          {errors['composition'] && <small className="adm-error">{errors['composition']}</small>}
        </label>
        <button type="submit" className="adm-btn" disabled={busy}>
          {t('species.addBreed')}
        </button>
      </form>
    </section>
  );
}

/** Rearing types (e.g. fighting cock) and breed groups of one animal type: added, renamed, (de)activated — never deleted. */
function Catalogue({ type, onChanged }: { type: AnimalTypeSummary; onChanged: () => void }) {
  const { t, validation } = useAdminI18n();
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [rearing, setRearing] = useState({ key: '', name: '', nameTh: '' });
  const [group, setGroup] = useState({ key: '', name: '', nameTh: '', rearingTypeKey: '' });

  const call = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErrors({});
    try {
      await fn();
      onChanged();
      return true;
    } catch (err) {
      setErrors({ _form: errorMessage(err) });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const clean = (x: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(x)
        .filter(([, v]) => v.trim() !== '')
        .map(([k, v]) => [k, v.trim()]),
    );

  const addRearing = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = addRearingTypeSchema.safeParse(clean(rearing));
    if (!parsed.success) return setErrors(issuesToErrors(parsed.error.issues, validation));
    if (
      await call(() =>
        api.request('POST', `/animal-types/${type.id}/rearing-types`, { body: parsed.data }),
      )
    )
      setRearing({ key: '', name: '', nameTh: '' });
  };
  const addGroup = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = addBreedGroupSchema.safeParse(clean(group));
    if (!parsed.success) return setErrors(issuesToErrors(parsed.error.issues, validation));
    if (
      await call(() =>
        api.request('POST', `/animal-types/${type.id}/breed-groups`, { body: parsed.data }),
      )
    )
      setGroup({ key: '', name: '', nameTh: '', rearingTypeKey: '' });
  };
  const toggle = (path: 'rearing-types' | 'breed-groups', key: string, active: boolean) =>
    void call(() =>
      api.request('PATCH', `/animal-types/${type.id}/${path}/${key}`, { body: { active } }),
    );
  const input = (value: string, onChange: (v: string) => void, label: string, error?: string) => (
    <label className="adm-field">
      <span>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
      />
      {error && <small className="adm-error">{error}</small>}
    </label>
  );

  return (
    <section aria-label={t('species.catalogue')}>
      <h3>{t('species.rearingTypes')}</h3>
      {errors['_form'] && (
        <p className="adm-error" role="alert">
          {errors['_form']}
        </p>
      )}
      <ul>
        {(type.rearingTypes ?? []).map((r) => (
          <li key={r.key}>
            {r.name}
            {r.nameTh && ` · ${r.nameTh}`} <code>{r.key}</code>{' '}
            <Tag value={r.active ? 'active' : 'inactive'} />{' '}
            <button
              type="button"
              className="adm-btn"
              disabled={busy}
              onClick={() => toggle('rearing-types', r.key, !r.active)}
            >
              {r.active ? t('action.deactivate') : t('action.reactivate')}
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={addRearing}
        noValidate
        aria-label={t('species.addRearingType')}
        className="adm-filters"
      >
        {input(
          rearing.key,
          (v) => setRearing((x) => ({ ...x, key: v })),
          t('species.key'),
          errors['key'],
        )}
        {input(
          rearing.name,
          (v) => setRearing((x) => ({ ...x, name: v })),
          t('common.name'),
          errors['name'],
        )}
        {input(
          rearing.nameTh,
          (v) => setRearing((x) => ({ ...x, nameTh: v })),
          t('species.nameTh'),
        )}
        <button type="submit" className="adm-btn" disabled={busy}>
          {t('species.addRearingType')}
        </button>
      </form>

      <h3>{t('species.breedGroups')}</h3>
      <ul>
        {(type.breedGroups ?? []).map((g) => (
          <li key={g.key}>
            {g.name}
            {g.nameTh && ` · ${g.nameTh}`} <code>{g.key}</code>{' '}
            <small className="adm-muted">
              ({type.breeds.filter((b) => b.groupKey === g.key).length} {t('species.breeds')})
            </small>{' '}
            <Tag value={g.active ? 'active' : 'inactive'} />{' '}
            <button
              type="button"
              className="adm-btn"
              disabled={busy}
              onClick={() => toggle('breed-groups', g.key, !g.active)}
            >
              {g.active ? t('action.deactivate') : t('action.reactivate')}
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={addGroup}
        noValidate
        aria-label={t('species.addBreedGroup')}
        className="adm-filters"
      >
        {input(
          group.key,
          (v) => setGroup((x) => ({ ...x, key: v })),
          t('species.key'),
          errors['key'],
        )}
        {input(
          group.name,
          (v) => setGroup((x) => ({ ...x, name: v })),
          t('common.name'),
          errors['name'],
        )}
        {input(group.nameTh, (v) => setGroup((x) => ({ ...x, nameTh: v })), t('species.nameTh'))}
        {(type.rearingTypes ?? []).length > 0 && (
          <label className="adm-field">
            <span>{t('species.rearingType')}</span>
            <select
              value={group.rearingTypeKey}
              onChange={(e) => setGroup((x) => ({ ...x, rearingTypeKey: e.target.value }))}
            >
              <option value="">{t('species.noGroup')}</option>
              {(type.rearingTypes ?? []).map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" className="adm-btn" disabled={busy}>
          {t('species.addBreedGroup')}
        </button>
      </form>
    </section>
  );
}
