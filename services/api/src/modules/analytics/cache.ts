/**
 * A small in-process TTL cache for expensive reports. Justification: dashboards run several aggregations over orders,
 * payments and records, are opened often, and tolerate being a minute old; a stale figure is labelled (`cached`,
 * `generatedAt`) and `fresh=true` recomputes. It is per API instance (use a shared store if you run several and need
 * identical answers). Keys always include the scope (farm / admin), the exact date range and filters AND the set of
 * sections the caller may see, so one user's cached answer can never be served to a user with different rights —
 * and authorisation is checked BEFORE the cache is consulted.
 */
interface Entry<T> {
  value: T;
  at: number;
}
export class TtlCache<T> {
  private readonly map = new Map<string, Entry<T>>();
  constructor(private readonly maxEntries = 500) {}

  get(key: string, ttlMs: number, now = Date.now()): { value: T; at: number } | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (now - e.at >= ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    return e;
  }
  set(key: string, value: T, now = Date.now()): void {
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, at: now });
  }
  clear(): void {
    this.map.clear();
  }
  get size(): number {
    return this.map.size;
  }
}
export const reportCache = new TtlCache<unknown>();
