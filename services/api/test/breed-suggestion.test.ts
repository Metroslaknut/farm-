import { filialGeneration, suggestOffspringBreed } from '@farmplus/shared-utils';
import { describe, expect, it } from 'vitest';
import { fightingCockCatalogue } from '../src/modules/animal-types/fighting-cock-catalogue';

const breeds = fightingCockCatalogue().breeds;

describe('suggestOffspringBreed (pure)', () => {
  it('follows the spec examples across generations', () => {
    expect(suggestOffspringBreed(breeds, 'pama_ma_lo', 'lueang_hang_khao')).toMatchObject({
      basis: 'composition_match',
      breed: 'cross_burmese_thai',
      groupKey: 'crossbred',
    });
    expect(suggestOffspringBreed(breeds, 'cross_burmese_thai', 'pama_ramwong').breed).toBe(
      'cross_burmese_thai',
    );
    expect(suggestOffspringBreed(breeds, 'cross_burmese_thai', 'saigon').breed).toBe(
      'cross_burmese_saigon_thai',
    );
    expect(suggestOffspringBreed(breeds, 'brazil', 'pama_hang_dam').breed).toBe(
      'cross_brazil_burmese',
    );
    expect(suggestOffspringBreed(breeds, 'cross_thai_pakoi', 'pama_roi').breed).toBe(
      'cross_burmese_thai_pakoi',
    );
  });

  it('same breed, same group, no match and unknown parents', () => {
    expect(suggestOffspringBreed(breeds, 'chi', 'chi')).toMatchObject({
      basis: 'same_breed',
      breed: 'chi',
    });
    const sameGroup = suggestOffspringBreed(breeds, 'chi', 'nok_daeng');
    expect(sameGroup).toEqual({ basis: 'same_group', groupKey: 'thai', components: ['thai'] });
    const none = suggestOffspringBreed(breeds, 'shamo', 'malay');
    expect(none).toMatchObject({ basis: 'no_match', groupKey: 'crossbred' });
    expect(none.breed).toBeUndefined();
    expect(suggestOffspringBreed(breeds, undefined, 'chi').basis).toBe('parent_unknown');
    expect(suggestOffspringBreed(breeds, 'not_a_breed', 'chi').basis).toBe('parent_unknown');
    // inactive cross-breeds are never suggested
    const inactive = breeds.map((b) =>
      b.key === 'cross_burmese_thai' ? { ...b, active: false } : b,
    );
    expect(suggestOffspringBreed(inactive, 'pama_ma_lo', 'chi').breed).toBeUndefined();
  });
});

describe('filialGeneration (pure)', () => {
  const tree: Record<string, { sireId?: string | null; damId?: string | null }> = {
    s0: {},
    d0: {},
    f1: { sireId: 's0', damId: 'd0' },
    h: {},
    f2: { sireId: 'f1', damId: 'h' },
    half: { sireId: 'f1' },
    child: { sireId: 'half', damId: 'h' },
  };
  const g = (id: string) => filialGeneration(id, (x) => tree[x]);
  it('counts from parent stock and never guesses', () => {
    expect([g('s0'), g('f1'), g('f2')]).toEqual([0, 1, 2]);
    expect(g('half')).toBeNull(); // only one parent recorded
    expect(g('child')).toBeNull(); // an ancestor is unknown
    expect(g('missing')).toBeNull(); // not loaded
  });
});
