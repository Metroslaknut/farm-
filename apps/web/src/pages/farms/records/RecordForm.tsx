/* eslint-disable @typescript-eslint/no-explicit-any -- generic record engine: shape is driven by the per-kind config/schema */
import { useMemo, useState, type FormEvent } from 'react';
import type { AnimalSummary, HealthRecordDTO, Page } from '@farmplus/shared-types';
import {
  fieldErrorsFromDetails,
  fieldErrorsFromZod,
  thaiToday,
  type FieldErrors,
} from '@farmplus/validation';
import { suggestOffspringBreed } from '@farmplus/shared-utils';
import { api } from '../../../api';
import { useLocale } from '../../../i18n';
import { loadAnimalTypes } from '../../../lib/animalTypes';
import { Alert, Button, Card, Select, TextField, Textarea } from '../../../components/ui';
import { errorMessage } from '../../../lib/format';
import { useAsync } from '../../../lib/useAsync';
import { breedLabel, localizeErrors, typeName, useFarmFormat, useFarmsT } from '../labels';
import { changesFrom, draftFromRecord, payloadFromDraft } from './formEngine';
import { CLUTCH_SECTION, type Draft, type Field, type KindConfig } from './recordConfigs';

interface Props {
  config: KindConfig;
  farmId: string;
  /** Present when correcting an existing record. */
  record?: any;
  /** Values to start with when creating (e.g. the animal you came from). */
  prefill?: Draft;
  onDone: (record: any) => void;
  onCancel: () => void;
}

const SECTION_ORDER = (fields: Field[]) => [...new Set(fields.map((f) => f.section))];

/**
 * One form for creating AND correcting every kind of husbandry record, driven by the kind's field list.
 * Validation uses the same schema as the API; a correction additionally asks for the reason and sends only what changed.
 */
export function RecordForm({ config, farmId, record, prefill, onDone, onCancel }: Props) {
  const t = useFarmsT();
  const fmt = useFarmFormat();
  const editing = Boolean(record);
  const initial = useMemo<Draft>(
    () =>
      record
        ? draftFromRecord(config.fields, record)
        : {
            ...Object.fromEntries(config.fields.map((f) => [f.name, ''])),
            ...defaultsFor(config),
            ...(prefill ?? {}),
          },
    [config, record, prefill],
  );
  const [draft, setDraft] = useState<Draft>(initial);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  const animals = useAsync(
    (signal) =>
      api.request<Page<AnimalSummary>>('GET', `/farms/${farmId}/animals`, {
        query: { pageSize: 100, archived: 'false', sortBy: 'animalCode', order: 'asc' },
        signal,
      }),
    [farmId],
  );
  const [locale] = useLocale();
  const breeding = config.kind === 'breeding';
  const types = useAsync(
    async () => (breeding ? (await loadAnimalTypes()).animalTypes : []),
    [breeding],
  );
  const findAnimal = (id: string | undefined) =>
    id ? animals.data?.items.find((a) => a.id === id) : undefined;
  const dam = findAnimal(draft['damId'] || record?.dam?.id);
  const sire = findAnimal(draft['sireId']);
  const damType = types.data?.find((x) => x.id === dam?.animalType.id);
  const eggLaying = damType?.reproduction === 'egg' || record?.reproduction === 'egg';
  const animalId = draft['animalId'];
  const related = useAsync(
    async (signal) =>
      animalId && config.fields.some((f) => f.type === 'health-ref')
        ? (
            await api.request<Page<HealthRecordDTO>>('GET', `/farms/${farmId}/health`, {
              query: { animalId, pageSize: 50 },
              signal,
            })
          ).items
        : [],
    [farmId, animalId],
  );

  const set = (name: string, value: string) => {
    setDraft((d) => ({ ...d, [name]: value }));
    setErrors((e) =>
      name in e ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== name)) : e,
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setErrors({});
    let path = `/farms/${farmId}/${config.path}`;
    let body: Record<string, unknown>;
    if (editing) {
      if (reason.trim().length < 3)
        return setErrors({
          _reason: t('rec.form.reasonRequired'),
        });
      const changes = changesFrom(config.fields, initial, draft);
      if (Object.keys(changes).length === 0)
        return setErrors({ _form: t('rec.form.nothingChanged') });
      path += `/${record.id}/corrections`;
      body = { reason: reason.trim(), changes };
    } else {
      body = payloadFromDraft(config.fields, draft);
      // Clutch counts belong to egg-laying species only (the section is hidden otherwise).
      if (breeding && !eggLaying) delete body['clutch'];
      const parsed = config.schema.safeParse(body);
      if (!parsed.success) return setErrors(localizeErrors(fieldErrorsFromZod(parsed.error)));
    }
    setBusy(true);
    try {
      const res = await api.request<{ record: any }>('POST', path, { body });
      onDone(res.record);
    } catch (e) {
      const fromApi = fieldErrorsFromDetails(
        (e as { details?: { path: string; message: string }[] }).details,
      );
      setErrors(
        Object.keys(fromApi).length > 0 ? localizeErrors(fromApi) : { _form: errorMessage(e) },
      );
    } finally {
      setBusy(false);
    }
  };

  const control = (f: Field) => {
    const common = {
      label: t(f.label),
      hint: f.hint && t(f.hint),
      error: errors[f.name],
      required: f.required,
      value: draft[f.name] ?? '',
      disabled: editing && f.lockedOnEdit,
    };
    if (f.type === 'textarea')
      return (
        <Textarea key={f.name} {...common} rows={3} onChange={(e) => set(f.name, e.target.value)} />
      );
    if (f.type === 'select' || f.type === 'animal' || f.type === 'health-ref') {
      const options =
        f.type === 'select'
          ? (f.options ?? []).map((o) => ({ value: o.value, label: t(o.label) }))
          : f.type === 'animal'
            ? (animals.data?.items ?? [])
                .filter((a) => !f.animalSex || a.sex === f.animalSex)
                .map((a) => ({
                  value: a.id,
                  label: [
                    `${a.animalCode}${a.name ? ` — ${a.name}` : ''}`,
                    breeding ? breedLabel(a, locale) : undefined,
                  ]
                    .filter(Boolean)
                    .join(' · '),
                }))
            : (related.data ?? [])
                .filter((r) => r.id !== record?.id)
                .map((r) => ({ value: r.id, label: `${fmt.date(r.recordedOn)} · ${r.title}` }));
      const optional = !f.required || f.optionalAnimal;
      return (
        <Select key={f.name} {...common} onChange={(e) => set(f.name, e.target.value)}>
          {optional && (
            <option value="">
              {f.emptyLabel
                ? t(f.emptyLabel)
                : t(f.type === 'select' ? 'rec.form.notSet' : 'rec.form.none')}
            </option>
          )}
          {!optional && <option value="">{t('common.choose')}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
    }
    const type = f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text';
    return (
      <TextField
        key={f.name}
        {...common}
        type={type}
        step={f.step}
        inputMode={f.type === 'number' ? 'decimal' : undefined}
        onChange={(e) => set(f.name, e.target.value)}
      />
    );
  };

  /** "พม่าม้าล่อ (สายพันธุ์ไก่พม่า)", or "breed not recorded". */
  const parentBreed = (a: AnimalSummary | undefined) => {
    if (!a) return t('pedigree.unknown');
    const name = breedLabel(a, locale);
    if (!name) return t('rec.breeding.noBreed');
    return a.breedGroup ? `${name} (${typeName(a.breedGroup, locale)})` : name;
  };
  /** Same rule as the API (shared code): a suggestion only — lineage is the real sire and dam. */
  const suggested = () => {
    if (!damType) return t('rec.breeding.suggestUnknown');
    const s = suggestOffspringBreed(damType.breeds, sire?.breed, dam?.breed);
    const b = s.breed ? damType.breeds.find((x) => x.key === s.breed) : undefined;
    if (b) return typeName(b, locale);
    const g = s.groupKey ? damType.breedGroups?.find((x) => x.key === s.groupKey) : undefined;
    if (g) return t('rec.breeding.suggestGroup', { group: typeName(g, locale) });
    return t(
      s.basis === 'parent_unknown' ? 'rec.breeding.suggestUnknown' : 'rec.breeding.suggestNone',
    );
  };

  return (
    <form onSubmit={submit} noValidate>
      {config.notice && (
        <Alert tone="warning" style={{ marginBottom: 'var(--ds-space-4)' }}>
          {t(config.notice)}
        </Alert>
      )}
      {SECTION_ORDER(config.fields).map((section) => {
        const fields = config.fields.filter(
          (f) => f.section === section && (!f.visible || f.visible(draft)),
        );
        if (fields.length === 0) return null;
        if (section === CLUTCH_SECTION && !eggLaying) return null;
        const parentsSection = breeding && section === 'rec.breeding.secParents';
        return (
          <Card
            key={section}
            title={t(section)}
            headingLevel={2}
            style={{ marginBottom: 'var(--ds-space-4)' }}
          >
            <div className="ds-grid ds-grid--2">{fields.map(control)}</div>
            {parentsSection && (dam || sire) && (
              <div
                role="status"
                className="ds-grid ds-grid--3"
                style={{ marginTop: 'var(--ds-space-3)' }}
              >
                <p>
                  <strong>{t('rec.breeding.damBreed')}</strong>
                  <br />
                  {parentBreed(dam)}
                </p>
                <p>
                  <strong>{t('rec.breeding.sireBreed')}</strong>
                  <br />
                  {parentBreed(sire)}
                </p>
                <p>
                  <strong>{t('rec.breeding.suggested')}</strong>
                  <br />
                  {suggested()}
                </p>
              </div>
            )}
          </Card>
        );
      })}
      {editing && (
        <Card
          title={t('rec.form.reasonTitle')}
          headingLevel={2}
          style={{ marginBottom: 'var(--ds-space-4)' }}
        >
          <p className="ds-field__hint">{t('rec.form.reasonHint')}</p>
          <Textarea
            label={t('rec.form.reasonLabel')}
            required
            rows={2}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setErrors((x) => ({ ...x, _reason: '' }));
            }}
            error={errors['_reason'] || undefined}
          />
        </Card>
      )}
      {errors['_form'] && (
        <Alert tone="danger" style={{ marginBottom: 'var(--ds-space-4)' }}>
          {errors['_form']}
        </Alert>
      )}
      <div className="ds-row">
        <Button type="submit" variant="primary" loading={busy}>
          {editing
            ? t('rec.form.saveCorrection')
            : t('rec.form.save', { singular: t(config.singular) })}
        </Button>
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
      </div>
    </form>
  );
}

function defaultsFor(config: KindConfig): Draft {
  const today = thaiToday();
  const d: Draft = {};
  for (const f of config.fields) {
    if (
      f.type === 'date' &&
      ['recordedOn', 'weighedOn', 'expenseDate', 'breedingDate', 'date'].includes(f.name)
    )
      d[f.name] = today;
  }
  if (config.kind === 'health') d['type'] = 'checkup';
  if (config.kind === 'weight') d['method'] = 'scale';
  if (config.kind === 'feeding') {
    d['kind'] = 'log';
    d['category'] = 'other';
    d['quantity.unit'] = 'kg';
  }
  if (config.kind === 'expense') d['category'] = 'feed';
  if (config.kind === 'breeding') d['method'] = 'natural';
  return d;
}
