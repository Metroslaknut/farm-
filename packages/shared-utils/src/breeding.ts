/**
 * Offspring breed SUGGESTION from the recorded parents' breeds (used by the API and the web form, never stored as
 * lineage). The real sire/dam links are the lineage; this only pre-fills the breed the user confirms or changes.
 *
 * Every breed stands for a set of lineage components: its `composition` when the catalogue gives one
 * (e.g. "Burmese + Thai" → {burmese, thai}), otherwise its group ({groupKey}). The offspring's components are the
 * union of both parents'. Then:
 *  - same breed on both sides           → that breed                     (`same_breed`)
 *  - one active breed has exactly those components → that breed         (`composition_match`)
 *  - all components are one group       → that group, breed left open    (`same_group`)
 *  - otherwise                          → no breed; the cross-breed group, if the catalogue has one (`no_match`)
 *  - a parent or its breed is unknown   → nothing suggested              (`parent_unknown`)
 */
export interface CatalogueBreedLike {
  key: string;
  active: boolean;
  groupKey?: string | null;
  composition?: readonly string[] | null;
}

export type BreedSuggestionBasis =
  'same_breed' | 'composition_match' | 'same_group' | 'no_match' | 'parent_unknown';

export interface BreedSuggestion {
  basis: BreedSuggestionBasis;
  breed?: string;
  groupKey?: string;
  /** The offspring's lineage components, sorted (empty when a parent is unknown). */
  components: string[];
}

export function breedComponents(breed: CatalogueBreedLike | undefined): string[] {
  if (!breed) return [];
  if (breed.composition && breed.composition.length > 0) return [...breed.composition];
  return breed.groupKey ? [breed.groupKey] : [breed.key];
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

export function suggestOffspringBreed(
  breeds: readonly CatalogueBreedLike[],
  sireBreed: string | null | undefined,
  damBreed: string | null | undefined,
): BreedSuggestion {
  const byKey = new Map(breeds.map((b) => [b.key, b]));
  const sire = sireBreed ? byKey.get(sireBreed) : undefined;
  const dam = damBreed ? byKey.get(damBreed) : undefined;
  if (!sire || !dam) return { basis: 'parent_unknown', components: [] };

  const components = [...new Set([...breedComponents(sire), ...breedComponents(dam)])].sort();
  if (sire.key === dam.key) {
    return {
      basis: 'same_breed',
      breed: sire.key,
      ...(sire.groupKey ? { groupKey: sire.groupKey } : {}),
      components,
    };
  }
  // A multi-component match is a cross-breed entry; a single component only matches a breed that names it explicitly.
  const match = breeds.find(
    (b) =>
      b.active &&
      b.composition &&
      b.composition.length > 0 &&
      sameSet([...b.composition], components),
  );
  if (match)
    return {
      basis: 'composition_match',
      breed: match.key,
      ...(match.groupKey ? { groupKey: match.groupKey } : {}),
      components,
    };
  const groups = new Set([sire.groupKey, dam.groupKey]);
  if (components.length === 1 && groups.size === 1 && sire.groupKey)
    return { basis: 'same_group', groupKey: sire.groupKey, components };

  const crossGroup = breeds.find((b) => b.active && (b.composition?.length ?? 0) > 1)?.groupKey;
  return { basis: 'no_match', ...(crossGroup ? { groupKey: crossGroup } : {}), components };
}

/**
 * Filial generation (F-number) from recorded parents: an animal with NO recorded parents is parent stock (F0); with
 * both parents recorded it is one more than the higher parent (F1 = first cross, F2 = an F1 × anything, …). With only
 * one parent recorded — or a parent whose own generation is unknown — the generation is unknown (`null`): it is never
 * guessed.
 */
export function filialGeneration(
  id: string,
  parentsOf: (id: string) => { sireId?: string | null; damId?: string | null } | undefined,
  memo: Map<string, number | null> = new Map(),
  depth = 0,
): number | null {
  if (memo.has(id)) return memo.get(id)!;
  const parents = parentsOf(id);
  let result: number | null;
  if (!parents || depth > 50) result = null;
  else if (!parents.sireId && !parents.damId) result = 0;
  else if (!parents.sireId || !parents.damId) result = null;
  else {
    const s = filialGeneration(parents.sireId, parentsOf, memo, depth + 1);
    const d = filialGeneration(parents.damId, parentsOf, memo, depth + 1);
    result = s === null || d === null ? null : Math.max(s, d) + 1;
  }
  memo.set(id, result);
  return result;
}
