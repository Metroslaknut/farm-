/* eslint-disable @typescript-eslint/no-explicit-any -- generic record engine: shape is driven by the per-kind config/schema */
import {
  BREEDING_METHODS,
  BREEDING_STATUSES,
  EXPENSE_CATEGORIES,
  FEEDING_KINDS,
  FEED_CATEGORIES,
  HEALTH_OUTCOMES,
  HEALTH_SEVERITIES,
  HEALTH_TYPES,
  PRESCRIBED_BY,
  QUANTITY_UNITS,
  STATED_BY,
  WEIGH_METHODS,
  type RecordKind,
} from '@farmplus/shared-types';
import {
  createBreedingSchema,
  createExpenseSchema,
  createFeedingSchema,
  createHealthSchema,
  createWeightSchema,
} from '@farmplus/validation';
import { getLocale } from '../../../i18n';
import { bahtLabel, enumLabel, type EnumGroup, type FarmsKey, type FarmsT } from '../labels';

export type Draft = Record<string, string>;
/** `label` is a catalog key (translated at render time), so the configs can stay module constants. */
export type Option = { value: string; label: FarmsKey };
export type FieldType =
  'text' | 'textarea' | 'date' | 'number' | 'select' | 'times' | 'animal' | 'health-ref';

export interface Field {
  /** Dotted path into the API payload, e.g. `medication.name`. */
  name: string;
  label: FarmsKey;
  type: FieldType;
  required?: boolean;
  hint?: FarmsKey;
  options?: Option[];
  section: FarmsKey;
  step?: string;
  /** Hide (and omit from the payload) unless this returns true. */
  visible?: (draft: Draft) => boolean;
  /** Fixed once the record exists (identity). */
  lockedOnEdit?: boolean;
  /** For `animal` fields. */
  animalSex?: 'male' | 'female';
  optionalAnimal?: boolean;
  emptyLabel?: FarmsKey;
  /** A baht amount: shown as "฿150.00" (e.g. in the correction history). */
  money?: boolean;
}

export interface Column {
  header: FarmsKey;
  /** Plain text/number, derived from the record, in the current language. */
  cell: (record: any, t: FarmsT, fmt: Fmt) => string;
}

/** Date formatting of the current language (see `useFarmFormat`). */
export interface Fmt {
  date: (value: string | undefined | null) => string;
}

export interface KindConfig {
  kind: RecordKind;
  /** URL segment, both in the app (`/farms/:id/<path>`) and in the API. */
  path: 'breeding' | 'health' | 'feeding' | 'weights' | 'expenses';
  /** Catalog keys: `kind.<path>.singular` ("health record") and `.plural` ("Health records"). */
  singular: FarmsKey;
  plural: FarmsKey;
  /** Farm permissions, as defined once in shared-types. */
  permissions: { read: string; write: string; correct: string };
  schema: {
    safeParse(input: unknown): { success: true; data: any } | { success: false; error: any };
  };
  fields: Field[];
  columns: Column[];
  describe: (record: any, t: FarmsT, fmt: Fmt) => [string, string | undefined][];
  title: (record: any, t: FarmsT, fmt: Fmt) => string;
  /** Filter selects shown on the list page (besides animal and dates). */
  filters?: { name: string; label: FarmsKey; options: Option[] }[];
  animalFilterName?: string;
  notice?: FarmsKey;
}

/** Options of an API enum, labelled from `enum.<group>.<value>`. */
const opts = (values: readonly string[], group: EnumGroup): Option[] =>
  values.map((v) => ({ value: v, label: `enum.${group}.${v}` as FarmsKey }));
const isType = (type: string) => (d: Draft) => d['type'] === type;
const q = (r: any, t: FarmsT) =>
  r.quantity ? `${r.quantity.amount} ${enumLabel(t, 'unit', r.quantity.unit)}` : '';
const en = (t: FarmsT, group: EnumGroup, v: string | undefined) => v && enumLabel(t, group, v);
const animalName = (a?: { animalCode: string; name?: string }) =>
  a ? `${a.animalCode}${a.name ? ` — ${a.name}` : ''}` : '';

export const HEALTH_NOTICE: FarmsKey = 'rec.health.notice';
export const CLUTCH_SECTION: FarmsKey = 'rec.breeding.secClutch';

/** "พม่าม้าล่อ (สายพันธุ์ไก่พม่า)" in the current language. */
export function breedRefLabel(
  b:
    | { key: string; name: string; nameTh?: string; group?: { name: string; nameTh?: string } }
    | undefined,
  _t: FarmsT,
): string | undefined {
  if (!b) return undefined;
  const th = getLocale() === 'th';
  const name = (th && b.nameTh) || b.name;
  const group = b.group && ((th && b.group.nameTh) || b.group.name);
  return group ? `${name} (${group})` : name;
}

/** The suggested offspring breed, or why there is none. */
export function suggestionLabel(
  s: { basis: string; breed?: any; group?: { name: string; nameTh?: string } } | undefined,
  t: FarmsT,
): string | undefined {
  if (!s) return undefined;
  if (s.breed) return breedRefLabel(s.breed, t);
  if (s.group) {
    const g = (getLocale() === 'th' && s.group.nameTh) || s.group.name;
    return t('rec.breeding.suggestGroup', { group: g });
  }
  return t(
    s.basis === 'parent_unknown' ? 'rec.breeding.suggestUnknown' : 'rec.breeding.suggestNone',
  );
}

// ---------------------------------------------------------------------------
const health: KindConfig = {
  kind: 'health',
  path: 'health',
  singular: 'kind.health.singular',
  plural: 'kind.health.plural',
  permissions: { read: 'records.read', write: 'records.write', correct: 'records.correct' },
  schema: createHealthSchema,
  notice: HEALTH_NOTICE,
  filters: [{ name: 'type', label: 'rec.type', options: opts(HEALTH_TYPES, 'healthType') }],
  animalFilterName: 'animalId',
  fields: [
    {
      name: 'animalId',
      label: 'common.animal',
      type: 'animal',
      required: true,
      lockedOnEdit: true,
      section: 'rec.health.sec.what',
    },
    {
      name: 'type',
      label: 'rec.type',
      type: 'select',
      required: true,
      options: opts(HEALTH_TYPES, 'healthType'),
      section: 'rec.health.sec.what',
    },
    {
      name: 'recordedOn',
      label: 'rec.date',
      type: 'date',
      required: true,
      section: 'rec.health.sec.what',
    },
    {
      name: 'title',
      label: 'rec.health.title',
      type: 'text',
      required: true,
      hint: 'rec.health.titleHint',
      section: 'rec.health.sec.what',
    },
    {
      name: 'symptoms',
      label: 'rec.health.symptoms',
      type: 'textarea',
      section: 'rec.health.sec.what',
    },
    {
      name: 'severity',
      label: 'rec.health.severity',
      type: 'select',
      options: opts(HEALTH_SEVERITIES, 'healthSeverity'),
      emptyLabel: 'rec.health.notAssessed',
      section: 'rec.health.sec.what',
    },
    {
      name: 'outcome',
      label: 'rec.health.outcome',
      type: 'select',
      required: true,
      options: opts(HEALTH_OUTCOMES, 'healthOutcome'),
      visible: isType('recovery'),
      section: 'rec.health.sec.what',
    },
    {
      name: 'relatedRecordId',
      label: 'rec.health.related',
      type: 'health-ref',
      visible: (d) => d['type'] === 'recovery' || d['type'] === 'treatment',
      hint: 'rec.optional',
      section: 'rec.health.sec.what',
    },
    {
      name: 'condition',
      label: 'rec.health.condition',
      type: 'text',
      hint: 'rec.health.conditionHint',
      section: 'rec.health.sec.who',
    },
    {
      name: 'conditionStatedBy',
      label: 'rec.health.statedBy',
      type: 'select',
      options: opts(STATED_BY, 'statedBy'),
      emptyLabel: 'rec.dash',
      section: 'rec.health.sec.who',
    },
    {
      name: 'medication.name',
      label: 'rec.health.medication',
      type: 'text',
      section: 'rec.health.sec.treatment',
    },
    {
      name: 'medication.dosage',
      label: 'rec.health.dosage',
      type: 'text',
      section: 'rec.health.sec.treatment',
    },
    {
      name: 'medication.route',
      label: 'rec.health.route',
      type: 'text',
      section: 'rec.health.sec.treatment',
    },
    {
      name: 'medication.batchNumber',
      label: 'rec.health.batch',
      type: 'text',
      section: 'rec.health.sec.treatment',
    },
    {
      name: 'prescribedBy',
      label: 'rec.health.prescribedBy',
      type: 'select',
      options: opts(PRESCRIBED_BY, 'prescribedBy'),
      emptyLabel: 'rec.dash',
      section: 'rec.health.sec.treatment',
    },
    {
      name: 'withdrawalEndsOn',
      label: 'rec.health.withdrawal',
      type: 'date',
      section: 'rec.health.sec.treatment',
    },
    {
      name: 'veterinarian.name',
      label: 'rec.health.vet',
      type: 'text',
      section: 'rec.health.sec.vet',
    },
    {
      name: 'veterinarian.licenseNo',
      label: 'rec.health.licence',
      type: 'text',
      section: 'rec.health.sec.vet',
    },
    {
      name: 'veterinarian.clinic',
      label: 'rec.health.clinic',
      type: 'text',
      section: 'rec.health.sec.vet',
    },
    {
      name: 'vaccine.name',
      label: 'rec.health.vaccine',
      type: 'text',
      required: true,
      visible: isType('vaccination'),
      section: 'rec.health.sec.vaccination',
    },
    {
      name: 'vaccine.batchNumber',
      label: 'rec.health.batch',
      type: 'text',
      visible: isType('vaccination'),
      section: 'rec.health.sec.vaccination',
    },
    {
      name: 'vaccine.manufacturer',
      label: 'rec.health.manufacturer',
      type: 'text',
      visible: isType('vaccination'),
      section: 'rec.health.sec.vaccination',
    },
    {
      name: 'nextDueOn',
      label: 'rec.health.nextDueStated',
      type: 'date',
      visible: isType('vaccination'),
      section: 'rec.health.sec.vaccination',
    },
    { name: 'notes', label: 'rec.notes', type: 'textarea', section: 'rec.notes' },
  ],
  columns: [
    { header: 'rec.date', cell: (r, _t, fmt) => fmt.date(r.recordedOn) },
    { header: 'common.animal', cell: (r) => animalName(r.animal) },
    { header: 'rec.type', cell: (r, t) => enumLabel(t, 'healthType', r.type) },
    { header: 'rec.description', cell: (r) => r.title },
    {
      header: 'rec.health.medicationVaccine',
      cell: (r) => r.medication?.name ?? r.vaccine?.name ?? '',
    },
  ],
  title: (r, t) => `${enumLabel(t, 'healthType', r.type)}: ${r.title}`,
  describe: (r, t, fmt) => [
    [t('common.animal'), animalName(r.animal)],
    [t('rec.type'), enumLabel(t, 'healthType', r.type)],
    [t('rec.date'), fmt.date(r.recordedOn)],
    [t('rec.description'), r.title],
    [t('rec.health.signsObserved'), r.symptoms],
    [t('rec.health.severityObserved'), en(t, 'healthSeverity', r.severity)],
    [
      t('rec.health.conditionShort'),
      r.condition &&
        t('rec.health.conditionStated', {
          condition: r.condition,
          by: enumLabel(t, 'statedByRaw', r.conditionStatedBy ?? ''),
        }),
    ],
    [
      t('rec.health.medicationShort'),
      r.medication &&
        [
          r.medication.name,
          r.medication.dosage,
          r.medication.route,
          r.medication.batchNumber && t('rec.health.batchValue', { no: r.medication.batchNumber }),
        ]
          .filter(Boolean)
          .join(' · '),
    ],
    [t('rec.health.prescribedByShort'), en(t, 'prescribedBy', r.prescribedBy)],
    [t('rec.health.withdrawalShort'), r.withdrawalEndsOn && fmt.date(r.withdrawalEndsOn)],
    [
      t('rec.health.vet'),
      r.veterinarian &&
        [
          r.veterinarian.name,
          r.veterinarian.clinic,
          r.veterinarian.licenseNo &&
            t('rec.health.licenceValue', { no: r.veterinarian.licenseNo }),
        ]
          .filter(Boolean)
          .join(' · '),
    ],
    [
      t('rec.health.vaccine'),
      r.vaccine &&
        [
          r.vaccine.name,
          r.vaccine.manufacturer,
          r.vaccine.batchNumber && t('rec.health.batchValue', { no: r.vaccine.batchNumber }),
        ]
          .filter(Boolean)
          .join(' · '),
    ],
    [t('rec.health.nextDue'), r.nextDueOn && fmt.date(r.nextDueOn)],
    [t('rec.health.outcome'), en(t, 'healthOutcome', r.outcome)],
    [t('rec.notes'), r.notes],
  ],
};

// ---------------------------------------------------------------------------
const weights: KindConfig = {
  kind: 'weight',
  path: 'weights',
  singular: 'kind.weights.singular',
  plural: 'kind.weights.plural',
  permissions: { read: 'records.read', write: 'records.write', correct: 'records.correct' },
  schema: createWeightSchema,
  animalFilterName: 'animalId',
  fields: [
    {
      name: 'animalId',
      label: 'common.animal',
      type: 'animal',
      required: true,
      lockedOnEdit: true,
      section: 'rec.weight.sec',
    },
    {
      name: 'weighedOn',
      label: 'rec.date',
      type: 'date',
      required: true,
      section: 'rec.weight.sec',
    },
    {
      name: 'weightKg',
      label: 'rec.weight.kg',
      type: 'number',
      step: '0.01',
      required: true,
      section: 'rec.weight.sec',
    },
    {
      name: 'method',
      label: 'rec.weight.method',
      type: 'select',
      options: opts(WEIGH_METHODS, 'weighMethod'),
      section: 'rec.weight.sec',
    },
    {
      name: 'heightCm',
      label: 'rec.weight.heightCm',
      type: 'number',
      step: '0.1',
      hint: 'rec.optional',
      section: 'rec.weight.sec',
    },
    {
      name: 'lengthCm',
      label: 'rec.weight.lengthCm',
      type: 'number',
      step: '0.1',
      hint: 'rec.optional',
      section: 'rec.weight.sec',
    },
    {
      name: 'bodyCondition',
      label: 'rec.weight.bodyCondition',
      type: 'text',
      hint: 'rec.weight.bodyConditionHint',
      section: 'rec.weight.sec',
    },
    { name: 'notes', label: 'rec.notes', type: 'textarea', section: 'rec.weight.sec' },
  ],
  columns: [
    { header: 'rec.date', cell: (r, _t, fmt) => fmt.date(r.weighedOn) },
    { header: 'common.animal', cell: (r) => animalName(r.animal) },
    { header: 'rec.weight.kg', cell: (r) => String(r.weightKg) },
    {
      header: 'rec.method',
      cell: (r, t) => (r.method ? enumLabel(t, 'weighMethod', r.method) : ''),
    },
  ],
  title: (r, t, fmt) => t('rec.weight.title', { kg: r.weightKg, date: fmt.date(r.weighedOn) }),
  describe: (r, t, fmt) => [
    [t('common.animal'), animalName(r.animal)],
    [t('rec.date'), fmt.date(r.weighedOn)],
    [t('rec.weight.weight'), t('common.kg', { value: r.weightKg })],
    [t('rec.method'), en(t, 'weighMethod', r.method)],
    [t('rec.weight.heightCm'), r.heightCm === undefined ? undefined : String(r.heightCm)],
    [t('rec.weight.lengthCm'), r.lengthCm === undefined ? undefined : String(r.lengthCm)],
    [t('rec.weight.bodyCondition'), r.bodyCondition],
    [t('rec.notes'), r.notes],
  ],
};

// ---------------------------------------------------------------------------
const isSchedule = (d: Draft) => d['kind'] === 'schedule';
const feeding: KindConfig = {
  kind: 'feeding',
  path: 'feeding',
  singular: 'kind.feeding.singular',
  plural: 'kind.feeding.plural',
  permissions: { read: 'records.read', write: 'records.write', correct: 'records.correct' },
  schema: createFeedingSchema,
  animalFilterName: 'animalId',
  filters: [
    {
      name: 'kind',
      label: 'common.kind',
      options: FEEDING_KINDS.map((v) => ({
        value: v,
        label: v === 'log' ? 'rec.feeding.log' : 'rec.feeding.schedule',
      })),
    },
  ],
  fields: [
    {
      name: 'kind',
      label: 'common.kind',
      type: 'select',
      required: true,
      options: FEEDING_KINDS.map((v) => ({
        value: v,
        label: v === 'log' ? 'rec.feeding.logLong' : 'rec.feeding.scheduleLong',
      })),
      lockedOnEdit: true,
      section: 'rec.feeding.sec.what',
    },
    {
      name: 'animalId',
      label: 'common.animal',
      type: 'animal',
      optionalAnimal: true,
      emptyLabel: 'rec.feeding.wholeFarmGroup',
      lockedOnEdit: true,
      section: 'rec.feeding.sec.who',
    },
    {
      name: 'groupLabel',
      label: 'rec.feeding.group',
      type: 'text',
      hint: 'rec.feeding.groupHint',
      section: 'rec.feeding.sec.who',
    },
    {
      name: 'feedName',
      label: 'rec.feeding.feed',
      type: 'text',
      required: true,
      section: 'rec.feeding.sec.what',
    },
    {
      name: 'category',
      label: 'rec.category',
      type: 'select',
      options: opts(FEED_CATEGORIES, 'feedCategory'),
      section: 'rec.feeding.sec.what',
    },
    {
      name: 'quantity.amount',
      label: 'rec.quantity',
      type: 'number',
      step: '0.01',
      required: true,
      section: 'rec.feeding.sec.what',
    },
    {
      name: 'quantity.unit',
      label: 'rec.unit',
      type: 'select',
      required: true,
      options: opts(QUANTITY_UNITS, 'unit'),
      section: 'rec.feeding.sec.what',
    },
    {
      name: 'date',
      label: 'rec.feeding.date',
      type: 'date',
      required: true,
      section: 'rec.feeding.sec.when',
    },
    {
      name: 'endDate',
      label: 'rec.feeding.endDate',
      type: 'date',
      visible: isSchedule,
      section: 'rec.feeding.sec.when',
    },
    {
      name: 'frequencyPerDay',
      label: 'rec.feeding.perDayLong',
      type: 'number',
      step: '1',
      visible: isSchedule,
      section: 'rec.feeding.sec.when',
    },
    {
      name: 'timesOfDay',
      label: 'rec.feeding.timesLong',
      type: 'times',
      visible: isSchedule,
      hint: 'rec.feeding.timesHint',
      section: 'rec.feeding.sec.when',
    },
    { name: 'notes', label: 'rec.notes', type: 'textarea', section: 'rec.notes' },
  ],
  columns: [
    { header: 'rec.date', cell: (r, _t, fmt) => fmt.date(r.date) },
    {
      header: 'common.kind',
      cell: (r, t) =>
        r.kind === 'schedule'
          ? t(r.active ? 'rec.feeding.scheduleRunning' : 'rec.feeding.schedule')
          : t('rec.feeding.logShort'),
    },
    {
      header: 'rec.feeding.who',
      cell: (r, t) =>
        r.animal ? animalName(r.animal) : (r.groupLabel ?? t('rec.feeding.wholeFarm')),
    },
    { header: 'rec.feeding.feed', cell: (r) => r.feedName },
    { header: 'rec.quantity', cell: (r, t) => q(r, t) },
  ],
  title: (r, t) =>
    t(r.kind === 'schedule' ? 'rec.feeding.titleSchedule' : 'rec.feeding.titleFed', {
      feed: r.feedName,
    }),
  describe: (r, t, fmt) => [
    [t('common.kind'), t(r.kind === 'schedule' ? 'rec.feeding.schedule' : 'rec.feeding.log')],
    [
      t('rec.feeding.who'),
      r.animal ? animalName(r.animal) : (r.groupLabel ?? t('rec.feeding.wholeFarm')),
    ],
    [t('rec.feeding.feed'), r.feedName],
    [t('rec.category'), enumLabel(t, 'feedCategory', r.category)],
    [t('rec.quantity'), q(r, t)],
    [t(r.kind === 'schedule' ? 'rec.feeding.starts' : 'rec.date'), fmt.date(r.date)],
    [t('rec.feeding.ends'), r.endDate && fmt.date(r.endDate)],
    [t('rec.feeding.perDay'), r.frequencyPerDay && String(r.frequencyPerDay)],
    [t('rec.feeding.times'), r.timesOfDay?.join(', ')],
    [t('rec.notes'), r.notes],
  ],
};

// ---------------------------------------------------------------------------
const expenses: KindConfig = {
  kind: 'expense',
  path: 'expenses',
  singular: 'kind.expenses.singular',
  plural: 'kind.expenses.plural',
  permissions: { read: 'expenses.read', write: 'expenses.write', correct: 'expenses.write' },
  schema: createExpenseSchema,
  animalFilterName: 'animalId',
  filters: [
    {
      name: 'category',
      label: 'rec.category',
      options: opts(EXPENSE_CATEGORIES, 'expenseCategory'),
    },
  ],
  fields: [
    {
      name: 'category',
      label: 'rec.category',
      type: 'select',
      required: true,
      options: opts(EXPENSE_CATEGORIES, 'expenseCategory'),
      section: 'rec.expense.sec',
    },
    {
      name: 'expenseDate',
      label: 'rec.date',
      type: 'date',
      required: true,
      section: 'rec.expense.sec',
    },
    {
      name: 'amount',
      label: 'rec.expense.amountThb',
      type: 'number',
      step: '0.01',
      required: true,
      money: true,
      section: 'rec.expense.sec',
    },
    {
      name: 'description',
      label: 'rec.description',
      type: 'text',
      required: true,
      section: 'rec.expense.sec',
    },
    { name: 'supplier', label: 'rec.expense.supplier', type: 'text', section: 'rec.expense.sec' },
    {
      name: 'animalId',
      label: 'rec.expense.attribute',
      type: 'animal',
      optionalAnimal: true,
      emptyLabel: 'rec.feeding.wholeFarm',
      section: 'rec.expense.secAttribution',
    },
    {
      name: 'quantity.amount',
      label: 'rec.expense.quantityBought',
      type: 'number',
      step: '0.01',
      section: 'rec.expense.secAttribution',
    },
    {
      name: 'quantity.unit',
      label: 'rec.unit',
      type: 'select',
      options: opts(QUANTITY_UNITS, 'unit'),
      emptyLabel: 'rec.dash',
      section: 'rec.expense.secAttribution',
    },
    { name: 'notes', label: 'rec.notes', type: 'textarea', section: 'rec.notes' },
  ],
  columns: [
    { header: 'rec.date', cell: (r, _t, fmt) => fmt.date(r.expenseDate) },
    { header: 'rec.category', cell: (r, t) => enumLabel(t, 'expenseCategory', r.category) },
    { header: 'rec.description', cell: (r) => r.description },
    { header: 'common.animal', cell: (r) => animalName(r.animal) },
    { header: 'rec.expense.amountThb', cell: (r) => bahtLabel(r.amount) },
  ],
  title: (r, t) => `${enumLabel(t, 'expenseCategory', r.category)}: ${r.description}`,
  describe: (r, t, fmt) => [
    [t('rec.category'), enumLabel(t, 'expenseCategory', r.category)],
    [t('rec.date'), fmt.date(r.expenseDate)],
    [t('rec.expense.amount'), bahtLabel(r.amount)],
    [t('rec.description'), r.description],
    [t('rec.expense.supplier'), r.supplier],
    [t('common.animal'), animalName(r.animal)],
    [t('rec.expense.linkedTo'), r.related && enumLabel(t, 'relatedKind', r.related.kind)],
    [t('rec.quantity'), r.quantity && q(r, t)],
    [t('rec.notes'), r.notes],
  ],
};

// ---------------------------------------------------------------------------
const breeding: KindConfig = {
  kind: 'breeding',
  path: 'breeding',
  singular: 'kind.breeding.singular',
  plural: 'kind.breeding.plural',
  permissions: { read: 'breeding.read', write: 'breeding.write', correct: 'breeding.correct' },
  schema: createBreedingSchema,
  filters: [
    {
      name: 'status',
      label: 'animals.col.status',
      options: opts(BREEDING_STATUSES, 'breedingStatus'),
    },
  ],
  // The API matches the animal as dam OR sire: one filter shows an animal's whole breeding history.
  animalFilterName: 'animalId',
  fields: [
    {
      name: 'damId',
      label: 'animalForm.dam',
      type: 'animal',
      animalSex: 'female',
      required: true,
      lockedOnEdit: true,
      section: 'rec.breeding.secParents',
    },
    {
      name: 'sireId',
      label: 'rec.breeding.sireOnFarm',
      type: 'animal',
      animalSex: 'male',
      optionalAnimal: true,
      emptyLabel: 'rec.breeding.sireUnknown',
      section: 'rec.breeding.secParents',
    },
    {
      name: 'sireExternal.name',
      label: 'rec.breeding.extName',
      type: 'text',
      hint: 'rec.breeding.extHint',
      section: 'rec.breeding.secParents',
    },
    {
      name: 'sireExternal.code',
      label: 'rec.breeding.extCode',
      type: 'text',
      section: 'rec.breeding.secParents',
    },
    {
      name: 'sireExternal.note',
      label: 'rec.breeding.extNote',
      type: 'text',
      section: 'rec.breeding.secParents',
    },
    {
      name: 'method',
      label: 'rec.method',
      type: 'select',
      options: opts(BREEDING_METHODS, 'breedingMethod'),
      section: 'rec.breeding.sec',
    },
    {
      name: 'breedingDate',
      label: 'rec.breeding.date',
      type: 'date',
      required: true,
      section: 'rec.breeding.sec',
    },
    // Egg-laying species only (the form shows this section when the dam's type lays eggs).
    ...(['eggsLaid', 'eggsFertile', 'eggsSet', 'chicksHatched'] as const).map((k): Field => ({
      name: `clutch.${k}`,
      label: `rec.breeding.clutch.${k}`,
      type: 'number',
      step: '1',
      section: CLUTCH_SECTION,
    })),
    { name: 'notes', label: 'rec.notes', type: 'textarea', section: 'rec.breeding.sec' },
  ],
  columns: [
    { header: 'rec.breeding.code', cell: (r) => r.code ?? '—' },
    { header: 'rec.breeding.bredOn', cell: (r, _t, fmt) => fmt.date(r.breedingDate) },
    { header: 'detail.dam', cell: (r) => animalName(r.dam) },
    {
      header: 'detail.sire',
      cell: (r) =>
        r.sire ? animalName(r.sire) : (r.sireExternal?.name ?? r.sireExternal?.code ?? '—'),
    },
    { header: 'animals.col.status', cell: (r, t) => enumLabel(t, 'breedingStatus', r.status) },
    {
      header: 'rec.breeding.expected',
      cell: (r, _t, fmt) => (r.expectedDeliveryDate ? fmt.date(r.expectedDeliveryDate) : ''),
    },
  ],
  title: (r, t, fmt) =>
    t('rec.breeding.title', {
      dam: r.dam?.animalCode ?? t('rec.breeding.damFallback'),
      date: fmt.date(r.breedingDate),
    }),
  describe: (r, t, fmt) => [
    [t('rec.breeding.code'), r.code],
    [t('detail.dam'), animalName(r.dam)],
    [t('rec.breeding.damBreed'), breedRefLabel(r.damBreed, t)],
    [
      t('detail.sire'),
      r.sire
        ? animalName(r.sire)
        : r.sireExternal &&
          [r.sireExternal.name, r.sireExternal.code, r.sireExternal.note]
            .filter(Boolean)
            .join(' · '),
    ],
    [t('rec.breeding.sireBreed'), breedRefLabel(r.sireBreed, t)],
    [t('rec.breeding.suggested'), suggestionLabel(r.offspringBreedSuggestion, t)],
    [t('rec.method'), enumLabel(t, 'breedingMethod', r.method)],
    [t('rec.breeding.bredOn'), fmt.date(r.breedingDate)],
    [t('animals.col.status'), enumLabel(t, 'breedingStatus', r.status)],
    [
      t('rec.breeding.expectedDelivery'),
      r.expectedDeliveryDate && fmt.date(r.expectedDeliveryDate),
    ],
    [
      t('rec.breeding.pregnancyConfirmed'),
      r.pregnancyConfirmedOn && fmt.date(r.pregnancyConfirmedOn),
    ],
    [
      t('rec.breeding.failedOn'),
      r.failedOn && `${fmt.date(r.failedOn)}${r.failureReason ? ` — ${r.failureReason}` : ''}`,
    ],
    [
      t(r.reproduction === 'egg' ? 'rec.breeding.hatched' : 'rec.breeding.delivered'),
      r.delivery?.date && fmt.date(r.delivery.date),
    ],
    ...(['eggsLaid', 'eggsFertile', 'eggsSet', 'chicksHatched'] as const).map(
      (k): [string, string | undefined] => [
        t(`rec.breeding.clutch.${k}`),
        r.clutch?.[k] === undefined ? undefined : String(r.clutch[k]),
      ],
    ),
    [t('rec.notes'), r.notes],
  ],
};

export const KINDS: Record<KindConfig['path'], KindConfig> = {
  breeding,
  health,
  feeding,
  weights,
  expenses,
};
export const KIND_LIST = [breeding, health, weights, feeding, expenses];
