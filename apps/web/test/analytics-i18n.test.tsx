import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { DashboardSection, MetricDefinition } from '@farmplus/shared-types';
import { SectionView } from '../src/components/analytics/DashboardView';
import analytics from '../src/i18n/messages/analytics';
import { setLocale } from '../src/i18n';

/**
 * Dashboards in Thai (staging QA 2026-11-25, task 3): the API's English labels are looked up in the `analytics`
 * catalog. These tests keep that catalog in step with the API: a renamed label would silently fall back to English.
 */
const API = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'services',
  'api',
  'src',
  'modules',
  'analytics',
);
const read = (f: string) => readFileSync(join(API, f), 'utf8');
const en = analytics.en as Record<string, string>;

afterEach(() => setLocale('en'));

describe('analytics catalog matches the API', () => {
  it('every metric the API defines has a label, and its English is the API label', () => {
    const defs = [
      ...read('definitions.ts').matchAll(/def\(\s*'(\w+)',\s*'(\w+)',\s*'(\w+)',\s*'([^']*)'/g),
    ];
    expect(defs.length).toBeGreaterThan(80);
    for (const [, scope, section, key, label] of defs) {
      expect(en[`metric.${scope}.${section}.${key}`], `${scope}.${section}.${key}`).toBe(label);
    }
  });

  it('every column, note and reason text is one the API really sends', () => {
    const source = read('farm.service.ts') + read('admin.service.ts');
    for (const [key, text] of Object.entries(en).filter(([k]) => /^(col|note|reason)\./.test(k)))
      expect(source.includes(`'${text}'`), `${key}: "${text}"`).toBe(true);
  });
});

describe('dashboard section in Thai', () => {
  const definitions: Record<string, MetricDefinition> = {
    'farm.animals.animalsOnFarm': {
      key: 'farm.animals.animalsOnFarm',
      scope: 'farm',
      section: 'animals',
      label: 'Animals on the farm',
      unit: 'count',
      definition: '',
      formula: '',
      includes: '',
      excludes: '',
      source: 'animals',
      caveats: null,
      timeBasis: 'now',
    },
  };
  const section = {
    available: true,
    metrics: { animalsOnFarm: 5 },
    series: {},
    tables: {
      byTypeAndStatus: {
        columns: ['Animal type', 'active', 'for_sale', 'Total'],
        rows: [['Buffalo', 4, 1, 5]],
      },
    },
    notes: ['AI assessments are decision support, not advice.'],
  } as unknown as DashboardSection;

  it('shows Thai labels, captions, columns, type names and notes', () => {
    setLocale('th');
    render(
      <SectionView
        id="animals"
        scope="farm"
        section={section}
        definitions={definitions}
        animalTypeLabel={(n) => (n === 'Buffalo' ? 'กระบือ' : n)}
      />,
    );
    expect(screen.getAllByText('สัตว์ที่กำลังเลี้ยง').length).toBeGreaterThan(0);
    const table = screen.getByRole('table', { name: 'จำนวนสัตว์ตามชนิดและสถานะ' });
    for (const th of ['ชนิดสัตว์', 'อยู่ในฟาร์ม', 'ประกาศขาย', 'รวม'])
      expect(within(table).getByRole('columnheader', { name: th })).toBeTruthy();
    expect(within(table).getByText('กระบือ')).toBeTruthy();
    expect(
      screen.getByText('การประเมินด้วย AI ใช้ช่วยตัดสินใจเท่านั้น ไม่ใช่คำแนะนำ'),
    ).toBeTruthy();
    for (const english of [
      'Animals on the farm',
      'Total',
      'Buffalo',
      'for_sale',
      'By Type And Status',
    ])
      expect(screen.queryByText(english)).toBeNull();
  });

  it('an unavailable section explains why in Thai', () => {
    setLocale('th');
    render(
      <SectionView
        id="costs"
        scope="farm"
        section={
          {
            available: false,
            reason: 'You do not have permission to see this farm’s expenses.',
          } as unknown as DashboardSection
        }
        definitions={{}}
      />,
    );
    expect(screen.getByText(/คุณไม่มีสิทธิ์ดูค่าใช้จ่ายของฟาร์มนี้/)).toBeTruthy();
  });
});
