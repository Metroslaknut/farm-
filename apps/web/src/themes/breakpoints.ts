/**
 * Breakpoints (min-width, px). CSS media queries cannot read custom properties, so these literals must
 * match the ones used in styles/*.css — test/design-tokens.test.ts fails if a stylesheet uses another value.
 *   mobile  < 768   (single column, collapsible navigation)
 *   tablet  >= 768  (horizontal navigation)
 *   desktop >= 1024
 */
export const BREAKPOINTS = { sm: 640, md: 768, lg: 1024, xl: 1280 } as const;
export type Breakpoint = keyof typeof BREAKPOINTS;

export const minWidthQuery = (bp: Breakpoint): string => `(min-width: ${BREAKPOINTS[bp]}px)`;
