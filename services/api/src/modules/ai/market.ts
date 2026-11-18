import type { PriceBasis } from '@farmplus/shared-types';
import { AiMarketPrice, Order } from '../../models';
import { quantile } from './engine';

const DAY = 86_400_000;
const stats = (prices: number[]) => {
  const s = [...prices].sort((a, b) => a - b);
  return {
    p25Minor: Math.round(quantile(s, 0.25)),
    medianMinor: Math.round(quantile(s, 0.5)),
    p75Minor: Math.round(quantile(s, 0.75)),
  };
};

/**
 * Authorised market data, and nothing else:
 *  1. completed FARM+ sales (orders that reached DELIVERED) of the same animal type and sex in the window, from OTHER farms
 *     only — aggregated, so no sale or seller can be identified (the extremes are never returned);
 *  2. prices an administrator imported with a recorded source and authorisation.
 * Each source is reported separately with its sample size; they are never blended, and nothing is ever filled in.
 */
export async function loadMarketBases(opts: {
  typeKey: string;
  typeName: string;
  sex: string;
  farmId: unknown;
  windowDays: number;
  now: Date;
}): Promise<PriceBasis[]> {
  const since = new Date(opts.now.getTime() - opts.windowDays * DAY);
  const bases: PriceBasis[] = [];
  const sexMatches = (s: string | null | undefined) =>
    opts.sex === 'unknown' || !s || s === 'unknown' || s === opts.sex;

  const salesFilter = {
    kind: 'animal',
    status: 'DELIVERED',
    deliveredAt: { $gte: since },
    farmId: { $ne: opts.farmId },
    'items.0.animal.animalTypeKey': opts.typeKey,
  };
  const sales = (await Order.find(salesFilter as never)
    .select('items')
    .limit(2000)
    .lean()) as unknown as {
    items: { unitPriceMinor: number; animal?: { sex?: string } }[];
  }[];
  const salePrices = sales
    .map((o) => o.items[0])
    .filter(
      (i): i is { unitPriceMinor: number; animal?: { sex?: string } } =>
        Boolean(i) && sexMatches(i?.animal?.sex),
    )
    .map((i) => i.unitPriceMinor);
  if (salePrices.length > 0)
    bases.push({
      source: 'farmplus_sales',
      label: 'Completed FARM+ sales',
      sampleSize: salePrices.length,
      windowDays: opts.windowDays,
      ...stats(salePrices),
      minMinor: null,
      maxMinor: null,
      used: false,
      note: null,
      scope: `${opts.typeName}, ${opts.sex === 'unknown' ? 'any sex' : opts.sex}, other farms`,
    });

  for (const kind of ['per_head', 'per_kg'] as const) {
    const rows = await AiMarketPrice.find({
      animalTypeKey: opts.typeKey,
      kind,
      active: true,
      observedOn: { $gte: since },
    }).lean();
    const prices = rows.filter((r) => sexMatches(r.sex)).map((r) => r.priceMinor);
    if (prices.length === 0) continue;
    const sources = [...new Set(rows.map((r) => r.source))].slice(0, 3).join(', ');
    bases.push({
      source: kind === 'per_head' ? 'imported_per_head' : 'imported_per_kg',
      label: `Imported market prices (${kind === 'per_head' ? 'per animal' : 'per kg'}) — ${sources}`,
      sampleSize: prices.length,
      windowDays: opts.windowDays,
      ...stats(prices),
      minMinor: null,
      maxMinor: null,
      used: false,
      note: null,
      scope: `${opts.typeName}, ${opts.sex === 'unknown' ? 'any sex' : opts.sex}`,
    });
  }
  return bases;
}
