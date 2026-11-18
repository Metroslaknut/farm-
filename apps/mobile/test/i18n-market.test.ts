import { describe, expect, it } from 'vitest';
import { setLocale } from '../src/i18n/locale';
import {
  ageText,
  daysText,
  listingStatusLabel,
  negotiationEventLabel,
  negotiationStatusLabel,
  orderReasonLabel,
  orderStatusLabel,
  partyLabel,
  requirementLabel,
  sexLabel,
  shipmentSourceLabel,
  shippingLabelText,
  unavailableReasonText,
} from '../src/lib/market-labels';
import market from '../src/i18n/messages/market';

describe('market catalog', () => {
  it('has the same keys in Thai and English', () => {
    expect(Object.keys(market.en).sort()).toEqual(Object.keys(market.th).sort());
  });
});

describe('market labels in English (unchanged wording)', () => {
  it('matches the previous humanized names', () => {
    expect(orderStatusLabel('PENDING_PAYMENT')).toBe('Pending payment');
    expect(listingStatusLabel('PENDING_REVIEW')).toBe('Pending review');
    expect(negotiationStatusLabel('open')).toBe('Open');
    expect(negotiationEventLabel('offer')).toBe('made an offer');
    expect(shipmentSourceLabel('provider')).toBe('carrier');
    expect(shipmentSourceLabel('seller')).toBe('seller');
    expect(sexLabel('female')).toBe('Female');
    expect(requirementLabel('health_certificate')).toBe('Health certificate');
    expect(partyLabel('buyer')).toBe('buyer');
    expect(daysText({ min: 2, max: 4 })).toBe('2–4 days');
    expect(daysText({ min: 3, max: 3 })).toBe('3 days');
    expect(ageText('3 y 2 m')).toBe('3 y 2 m');
    expect(shippingLabelText('Delivery arranged by the seller')).toBe(
      'Delivery arranged by the seller',
    );
    expect(unavailableReasonText('The seller does not deliver to Chiang Mai.')).toBe(
      'The seller does not deliver to Chiang Mai.',
    );
    expect(unavailableReasonText('Something new')).toBe('Something new');
    expect(unavailableReasonText(undefined)).toBe('No delivery option for this address.');
  });
  it('falls back to the humanized value for unknown values', () => {
    expect(orderStatusLabel('ON_HOLD')).toBe('On hold');
    expect(orderReasonLabel('changed_my_mind')).toBe('Changed my mind');
    expect(negotiationEventLabel('nudge')).toBe('nudge');
  });
});

describe('market labels in Thai', () => {
  it('translates statuses, events and units', () => {
    setLocale('th');
    expect(orderStatusLabel('PENDING_PAYMENT')).toBe('รอชำระเงิน');
    expect(listingStatusLabel('SOLD')).toBe('ขายแล้ว');
    expect(negotiationStatusLabel('accepted')).toBe('ตอบรับแล้ว');
    expect(negotiationEventLabel('counter')).toBe('เสนอราคากลับ');
    expect(orderReasonLabel('payment_window_expired')).toBe('เลยกำหนดชำระเงิน');
    expect(sexLabel('male')).toBe('เพศผู้');
    expect(requirementLabel('movement_permit')).toBe('ใบอนุญาตเคลื่อนย้ายสัตว์');
    expect(daysText({ min: 2, max: 4 })).toBe('2–4 วัน');
    expect(ageText('3 y 2 m')).toBe('3 ปี 2 เดือน');
    expect(ageText('12 d')).toBe('12 วัน');
    expect(shippingLabelText('Delivery arranged by the seller')).toBe('ผู้ขายจัดส่งให้');
    expect(unavailableReasonText('The seller does not deliver to เชียงใหม่.')).toBe(
      'ผู้ขายไม่จัดส่งไปยังเชียงใหม่',
    );
    expect(unavailableReasonText('Something new')).toBe('ไม่มีบริการจัดส่งสำหรับที่อยู่นี้');
  });
});
