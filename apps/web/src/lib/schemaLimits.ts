/**
 * The longest text a field of a shared (Zod) schema accepts, so a form can say so while typing (`maxLength` and a
 * counter) instead of only after "Save" (staging QA #18). Follows dotted paths (`sireExternal.name`) through optional,
 * nullable and default wrappers. Unknown shapes give `undefined`: the field just has no limit shown, the API still
 * checks it.
 */
type Node = {
  shape?: Record<string, unknown>;
  maxLength?: number | null;
  unwrap?: () => unknown;
  _zod?: { def?: { innerType?: unknown; in?: unknown; shape?: Record<string, unknown> } };
};

function inner(node: unknown): Node | undefined {
  let n = node as Node | undefined;
  for (let i = 0; i < 8 && n; i++) {
    const def = n._zod?.def;
    if (typeof n.unwrap === 'function' && !n.shape) n = n.unwrap() as Node;
    else if (def?.innerType) n = def.innerType as Node;
    else if (def?.in) n = def.in as Node;
    else break;
  }
  return n;
}

export function maxLengthOf(schema: unknown, path: string): number | undefined {
  let node = inner(schema);
  for (const key of path.split('.')) {
    const shape = node?.shape ?? node?._zod?.def?.shape;
    node = inner(shape?.[key]);
    if (!node) return undefined;
  }
  const max = node?.maxLength;
  return typeof max === 'number' && Number.isFinite(max) ? max : undefined;
}
