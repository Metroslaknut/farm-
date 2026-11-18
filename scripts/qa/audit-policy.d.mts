export interface Waiver {
  id: string;
  package: string;
  severity: string;
  reason: string;
  owner: string;
  expires: string;
}
export function evaluate(
  advisories: Record<
    string,
    {
      severity: string;
      module_name: string;
      github_advisory_id: string;
      findings: { version: string; paths: string[] }[];
    }
  >,
  waivers: Waiver[],
  now?: Date,
): { failures: string[]; notes: string[] };
