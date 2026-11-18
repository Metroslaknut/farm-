import type { AnimalDetail } from '@farmplus/shared-types';

/** What the animal form edits, as strings (empty = not given). Shared by the register and edit screens. */
export interface AnimalFormValues {
  animalCode: string;
  animalTypeId: string;
  breed: string;
  name: string;
  sex: string;
  birthDate: string;
  birthDateEstimated: boolean;
  acquisitionDate: string;
  originKind: string;
  originNote: string;
  currentStatus: string;
  sireId: string;
  damId: string;
  color: string;
  notes: string;
}

export const EMPTY_ANIMAL: AnimalFormValues = {
  animalCode: '',
  animalTypeId: '',
  breed: '',
  name: '',
  sex: '',
  birthDate: '',
  birthDateEstimated: false,
  acquisitionDate: '',
  originKind: 'born_on_farm',
  originNote: '',
  currentStatus: 'active',
  sireId: '',
  damId: '',
  color: '',
  notes: '',
};

export const valuesOf = (a: AnimalDetail): AnimalFormValues => ({
  animalCode: a.animalCode,
  animalTypeId: a.animalType.id,
  breed: a.breed ?? '',
  name: a.name ?? '',
  sex: a.sex,
  birthDate: a.birthDate ?? '',
  birthDateEstimated: a.birthDateEstimated,
  acquisitionDate: a.acquisitionDate ?? '',
  originKind: a.origin.kind,
  originNote: a.origin.note ?? '',
  currentStatus: a.currentStatus,
  sireId: a.sire?.id ?? '',
  damId: a.dam?.id ?? '',
  color: a.color ?? '',
  notes: a.notes ?? '',
});

const opt = (s: string) => (s.trim() === '' ? undefined : s.trim());
const origin = (v: AnimalFormValues) => ({
  kind: v.originKind,
  ...(opt(v.originNote) ? { note: v.originNote.trim() } : {}),
});

/** Body for `POST /farms/:id/animals` (to be checked with `createAnimalSchema`): empty optional fields are omitted. */
export function createBody(v: AnimalFormValues): Record<string, unknown> {
  return {
    ...(opt(v.animalCode) ? { animalCode: v.animalCode.trim() } : {}),
    animalTypeId: v.animalTypeId,
    ...(v.breed ? { breed: v.breed } : {}),
    ...(opt(v.name) ? { name: v.name.trim() } : {}),
    sex: v.sex,
    ...(opt(v.birthDate) ? { birthDate: v.birthDate.trim() } : {}),
    birthDateEstimated: v.birthDateEstimated,
    ...(opt(v.acquisitionDate) ? { acquisitionDate: v.acquisitionDate.trim() } : {}),
    origin: origin(v),
    currentStatus: v.currentStatus,
    ...(v.sireId ? { sireId: v.sireId } : {}),
    ...(v.damId ? { damId: v.damId } : {}),
    ...(opt(v.color) ? { color: v.color.trim() } : {}),
    ...(opt(v.notes) ? { notes: v.notes.trim() } : {}),
  };
}

const NULLABLE = [
  'breed',
  'name',
  'birthDate',
  'acquisitionDate',
  'sireId',
  'damId',
  'color',
  'notes',
] as const;

/**
 * Body for `PATCH /farms/:id/animals/:animalId` (checked with `updateAnimalSchema`): only what changed; clearing an
 * optional field sends `null`. Code and type are identity and never sent.
 */
export function patchBody(base: AnimalFormValues, v: AnimalFormValues): Record<string, unknown> {
  const diff: Record<string, unknown> = {};
  for (const k of NULLABLE) if (v[k].trim() !== base[k].trim()) diff[k] = opt(v[k]) ?? null;
  if (v.sex !== base.sex) diff['sex'] = v.sex;
  if (v.currentStatus !== base.currentStatus) diff['currentStatus'] = v.currentStatus;
  if (v.birthDateEstimated !== base.birthDateEstimated)
    diff['birthDateEstimated'] = v.birthDateEstimated;
  if (v.originKind !== base.originKind || v.originNote.trim() !== base.originNote.trim())
    diff['origin'] = origin(v);
  return diff;
}
