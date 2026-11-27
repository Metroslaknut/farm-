import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { HistoryEvent } from '@farmplus/shared-types';
import { setLocale } from '../src/i18n';
import { eventText } from '../src/pages/farms/records/AnimalHistoryPage';
import { useFarmsT } from '../src/pages/farms/labels';

/** Staging QA 2026-11-25, task 3: the animal history was in English while the site was in Thai. */
afterEach(() => setLocale('en'));

const ev = (over: Partial<HistoryEvent>): HistoryEvent => ({
  key: 'k',
  type: 'weight',
  date: '2026-11-01',
  title: 'English title',
  ...over,
});

function thaiT() {
  setLocale('th');
  return renderHook(() => useFarmsT()).result.current;
}

describe('animal history in Thai', () => {
  it('weights, health, expenses, feeding and breeding are worded from their values', () => {
    const t = thaiT();
    expect(
      eventText(t, ev({ detail: { kind: 'weight', weightKg: 305, method: 'tape_estimate' } })),
    ).toEqual({ title: 'ชั่งน้ำหนัก 305 กก.', summary: 'ประมาณด้วยสายวัด' });
    expect(
      eventText(
        t,
        ev({
          type: 'health',
          detail: {
            kind: 'health',
            healthType: 'checkup',
            title: 'ตรวจประจำเดือน',
            vaccine: 'FMD',
          },
        }),
      ),
    ).toEqual({ title: 'ตรวจสุขภาพ: ตรวจประจำเดือน', summary: 'วัคซีน: FMD' });
    const expense = eventText(
      t,
      ev({
        type: 'expense',
        detail: { kind: 'expense', category: 'feed', description: 'ฟาง', amountMinor: 1234 },
      }),
    );
    expect(expense.title).toBe('อาหารสัตว์: ฟาง');
    expect(expense.summary).toContain('12.34');
    expect(
      eventText(
        t,
        ev({
          type: 'feeding',
          detail: { kind: 'feeding', schedule: false, feedName: 'ฟาง', amount: 3, unit: 'kg' },
        }),
      ),
    ).toEqual({ title: 'ให้อาหาร: ฟาง', summary: '3 กก.' });
    const breeding = eventText(
      t,
      ev({
        type: 'breeding',
        detail: {
          kind: 'breeding',
          method: 'natural',
          status: 'pregnant',
          partner: { role: 'sire', code: 'B-002' },
        },
      }),
    );
    expect(breeding.title).toBe('ผสมพันธุ์ (ผสมตามธรรมชาติ)');
    expect(breeding.summary).toBe('พ่อพันธุ์ B-002 · ตั้งท้อง');
  });

  it('profile changes name the fields in Thai; unknown events keep the API wording', () => {
    const t = thaiT();
    expect(
      eventText(
        t,
        ev({
          type: 'animal',
          detail: { kind: 'audit', action: 'animal.updated', fields: ['name'] },
        }),
      ),
    ).toEqual({ title: 'แก้ไขข้อมูล', summary: 'แก้ไข: ชื่อ' });
    expect(eventText(t, ev({ title: 'Something new', summary: 'as sent' }))).toEqual({
      title: 'Something new',
      summary: 'as sent',
    });
  });
});
