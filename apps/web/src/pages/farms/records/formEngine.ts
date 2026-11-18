/* eslint-disable @typescript-eslint/no-explicit-any -- generic record engine: shape is driven by the per-kind config/schema */
import type { Draft, Field } from './recordConfigs';

const get = (obj: any, path: string): unknown =>
  path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** Turn a stored record into editable text values (dotted field names → flat draft). */
export function draftFromRecord(fields: Field[], record: any): Draft {
  const draft: Draft = {};
  for (const f of fields) {
    let v: unknown;
    if (f.name === 'animalId') v = record.animal?.id;
    else if (f.name === 'damId') v = record.dam?.id;
    else if (f.name === 'sireId') v = record.sire?.id;
    else if (f.name.startsWith('sireExternal.'))
      v = get(record.sireExternal, f.name.slice('sireExternal.'.length));
    else v = get(record, f.name);
    draft[f.name] = v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v);
  }
  return draft;
}

const visible = (f: Field, draft: Draft) => !f.visible || f.visible(draft);

function convert(f: Field, raw: string): unknown {
  const v = raw.trim();
  if (v === '') return undefined;
  if (f.type === 'number') return Number(v);
  if (f.type === 'times')
    return v
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  return v;
}

/** Build the nested API payload from a draft: empty strings and hidden fields are omitted. */
export function payloadFromDraft(
  fields: Field[],
  draft: Draft,
  only?: (f: Field) => boolean,
): Record<string, unknown> {
  const out: Record<string, any> = {};
  for (const f of fields) {
    if (only && !only(f)) continue;
    if (!visible(f, draft)) continue;
    const value = convert(f, draft[f.name] ?? '');
    if (value === undefined) continue;
    const keys = f.name.split('.');
    let cursor = out;
    keys.slice(0, -1).forEach((k) => (cursor = cursor[k] ??= {}));
    cursor[keys[keys.length - 1]!] = value;
  }
  return out;
}

/**
 * For a correction: only the top-level properties whose value changed. A property that became empty is sent as
 * `null` (the API's "clear this field"). The server re-validates the whole merged record.
 */
export function changesFrom(
  fields: Field[],
  initial: Draft,
  current: Draft,
): Record<string, unknown> {
  const editable = fields.filter((f) => !f.lockedOnEdit);
  const before = payloadFromDraft(editable, initial);
  const after = payloadFromDraft(editable, current);
  const changes: Record<string, unknown> = {};
  for (const key of new Set(editable.map((f) => f.name.split('.')[0]!))) {
    if (JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))
      changes[key] = after[key] ?? null;
  }
  return changes;
}
