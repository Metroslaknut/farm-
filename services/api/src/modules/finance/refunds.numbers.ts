import { randomBytes } from 'node:crypto';

const stamp = () => {
  const d = new Date();
  return `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
};
const number = (prefix: string) =>
  `${prefix}-${stamp()}-${randomBytes(4).toString('hex').toUpperCase()}`;
export const newRefundNo = () => number('RF');
export const newWithdrawalNo = () => number('WD');
