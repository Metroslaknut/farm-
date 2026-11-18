/** Append a fetched page to the list, ignoring rows already present (pages can overlap when data changes). */
export function mergePage<T extends { id: string }>(
  previous: T[],
  incoming: T[],
  page: number,
): T[] {
  if (page <= 1) return incoming;
  const seen = new Set(previous.map((item) => item.id));
  return [...previous, ...incoming.filter((item) => !seen.has(item.id))];
}

export const hasMorePages = (loaded: number, total: number): boolean => loaded < total;
