import { describe, expect, it } from 'vitest';
import { catalogs } from '../src/i18n';
import { setLocale } from '../src/i18n/locale';
import {
  ageText,
  localizeFieldErrors,
  originLabel,
  roleLabel,
  sexLabel,
  statusLabel,
} from '../src/lib/farm-ui';

const NOW = new Date('2024-06-15T05:00:00Z');

describe('farm labels follow the language', () => {
  it('English stays as before (humanized enum values)', () => {
    expect(roleLabel('owner')).toBe('Owner');
    expect(statusLabel('for_sale')).toBe('For sale');
    expect(sexLabel('female')).toBe('Female');
    expect(originLabel('born_on_farm')).toBe('Born on farm');
    expect(ageText('2022-04-01', NOW)).toBe('2 y 2 m');
    expect(ageText('2024-06-10', NOW)).toBe('5 d');
  });

  it('Thai names enum values and ages', () => {
    setLocale('th');
    expect(roleLabel('owner')).toBe('เจ้าของฟาร์ม');
    expect(statusLabel('for_sale')).toBe('ประกาศขาย');
    expect(sexLabel('male')).toBe('เพศผู้');
    expect(sexLabel('female')).toBe('เพศเมีย');
    expect(originLabel('purchased')).toBe('ซื้อมา');
    expect(ageText('2022-04-01', NOW)).toBe('2 ปี 2 เดือน');
    expect(ageText('2024-06-10', NOW)).toBe('5 วัน');
    expect(ageText(undefined)).toBeUndefined();
  });

  it('unknown values fall back to humanize in both languages', () => {
    setLocale('th');
    expect(statusLabel('on_loan')).toBe('On loan');
  });

  it('field errors are passed through the validation translator', () => {
    expect(localizeFieldErrors({ sex: 'Choose the animal’s sex' })).toEqual({
      sex: 'Choose the animal’s sex',
    });
    setLocale('th');
    const th = localizeFieldErrors({ sex: 'Choose the animal’s sex' });
    expect(Object.keys(th)).toEqual(['sex']);
  });

  it('Thai and English catalogs have the same keys', () => {
    expect(Object.keys(catalogs.farms.en).sort()).toEqual(Object.keys(catalogs.farms.th).sort());
  });
});
