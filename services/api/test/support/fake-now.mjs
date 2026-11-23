/**
 * Preloaded by `pnpm test:thai-night` (via NODE_OPTIONS in every Vitest worker): the clock reads FARMPLUS_FAKE_NOW
 * (HH:MM, Bangkok time, default 00:30) on today's Thai date and then keeps ticking. Timers are untouched, so the
 * in-memory MongoDB and timeouts behave normally. `Date` is wrapped in a Proxy rather than subclassed because Mongoose
 * recognises the `Date` schema type by identity/name.
 */
import process from 'node:process';

const hhmm = /^(\d{2}):(\d{2})$/.exec(process.env.FARMPLUS_FAKE_NOW ?? '00:30');
if (!hhmm) throw new Error('FARMPLUS_FAKE_NOW must be HH:MM (Bangkok time)');
const OFFSET = 7 * 3_600_000;
const RealDate = Date;
const realNow = RealDate.now();
const thaiDay = new RealDate(realNow + OFFSET).toISOString().slice(0, 10);
const target = RealDate.parse(`${thaiDay}T${hhmm[1]}:${hhmm[2]}:00.000Z`) - OFFSET; // that Bangkok wall-clock time, as UTC
const shift = target - realNow;
const now = () => RealDate.now() + shift;

globalThis.Date = new Proxy(RealDate, {
  construct(target_, args, newTarget) {
    return Reflect.construct(
      target_,
      args.length === 0 ? [now()] : args,
      newTarget === globalThis.Date ? target_ : newTarget,
    );
  },
  apply() {
    return new RealDate(now()).toString();
  },
  get(target_, prop, receiver) {
    return prop === 'now' ? now : Reflect.get(target_, prop, receiver);
  },
});
