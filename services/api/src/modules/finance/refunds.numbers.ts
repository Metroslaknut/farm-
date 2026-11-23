import { randomBytes } from 'node:crypto';
import { thaiYymmdd } from '@farmplus/validation';

/** yymmdd of the Thai calendar day (the random suffix keeps numbers unique). */
const stamp = () => thaiYymmdd();
const number = (prefix: string) =>
  `${prefix}-${stamp()}-${randomBytes(4).toString('hex').toUpperCase()}`;
export const newRefundNo = () => number('RF');
export const newWithdrawalNo = () => number('WD');
