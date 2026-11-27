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

describe('metric explanations and alerts (Thai details, follow-up of task 3)', () => {
  it('every explanation of every metric is in the catalog, and its English is exactly the API text', async () => {
    const { DEFINITIONS } = await import('../../../services/api/src/modules/analytics/definitions');
    expect(DEFINITIONS.length).toBeGreaterThan(90);
    const th = analytics.th as Record<string, string>;
    for (const d of DEFINITIONS)
      for (const field of ['definition', 'includes', 'excludes', 'caveats'] as const) {
        const english = d[field];
        const key = `def.${d.key}.${field}`;
        if (english === null) {
          expect(en[key], key).toBeUndefined();
          continue;
        }
        expect(en[key], key).toBe(english);
        expect(th[key]?.trim().length, key).toBeGreaterThan(0);
      }
  });

  it('every admin alert code has a Thai and English text', () => {
    const codes = [...read('admin.service.ts').matchAll(/code: '([a-z_]+)'/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(5);
    for (const code of codes) expect(en[`alert.${code}`], code).toBeTruthy();
  });

  it('an alert is worded in Thai from its code and figures', () => {
    setLocale('th');
    render(
      <SectionView
        id="alerts"
        scope="admin"
        definitions={{}}
        section={
          {
            available: true,
            metrics: {},
            series: {},
            tables: {},
            alerts: [
              {
                code: 'payment_failure_rate',
                severity: 'caution',
                count: 4,
                params: { total: 10, percent: 40 },
                message: '4 of 10 payments failed in the last 24 hours (40%).',
              },
            ],
          } as unknown as DashboardSection
        }
      />,
    );
    expect(
      screen.getByText(/ชำระเงินไม่สำเร็จ 4 จาก 10 รายการใน 24 ชั่วโมงที่ผ่านมา \(40%\)/),
    ).toBeTruthy();
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
