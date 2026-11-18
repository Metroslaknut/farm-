export interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  detail: string;
}
export function parseTarget(
  url: string | undefined,
  label: string,
): { base: string; https: boolean } | null;
export function run(options: {
  api?: { base: string; https: boolean } | null;
  web?: { base: string; https: boolean } | null;
  origin?: string | undefined;
  fetchImpl?: typeof fetch;
}): Promise<CheckResult[]>;
