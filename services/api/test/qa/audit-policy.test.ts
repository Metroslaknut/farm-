import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluate } from '../../../../scripts/qa/audit-policy.mjs';

const adv = (id: string, severity: string, importer: string, name = 'pkg') => ({
  severity,
  module_name: name,
  github_advisory_id: id,
  findings: [{ version: '1.0.0', paths: [`${importer}>a>${name}`] }],
});
const waiver = (id: string, expires = '2099-01-01') => ({
  id,
  package: 'pkg',
  severity: 'high',
  reason: 'tooling only',
  owner: 'me',
  expires,
});

describe('dependency audit policy', () => {
  it('fails any moderate-or-worse advisory in a server or web runtime dependency, and it cannot be waived', () => {
    for (const importer of [
      'services__api',
      'services__worker',
      'packages__shared-utils',
      'apps__web',
    ])
      for (const severity of ['moderate', 'high', 'critical']) {
        const r = evaluate({ x: adv('G1', severity, importer) }, [waiver('G1')]);
        expect(r.failures, `${importer} ${severity}`).toHaveLength(1);
        expect(r.failures[0]).toContain('not waivable');
      }
    expect(evaluate({ x: adv('G1', 'low', 'services__api') }, []).failures).toEqual([]);
  });

  it('fails high/critical in build tooling unless waived with an unexpired waiver', () => {
    expect(evaluate({ x: adv('G2', 'high', 'apps__mobile') }, []).failures).toHaveLength(1);
    expect(evaluate({ x: adv('G2', 'critical', 'e2e') }, []).failures).toHaveLength(1);
    expect(evaluate({ x: adv('G2', 'high', 'apps__mobile') }, [waiver('G2')]).failures).toEqual([]);
    expect(
      evaluate({ x: adv('G2', 'high', 'apps__mobile') }, [
        waiver('G2', '2020-01-01'),
      ]).failures.join(),
    ).toMatch(/expired/);
    expect(evaluate({ x: adv('G3', 'moderate', 'apps__mobile') }, []).failures).toEqual([]);
  });

  it('every committed waiver is complete and unexpired', () => {
    const { waivers } = JSON.parse(
      readFileSync(join(process.cwd(), '../../docs/qa/audit-waivers.json'), 'utf8'),
    );
    for (const w of waivers) {
      expect(w.id).toMatch(/^GHSA-[a-z0-9-]+$/);
      for (const k of ['package', 'severity', 'reason', 'owner', 'expires'])
        expect(String(w[k] ?? ''), `${w.id}.${k}`).not.toBe('');
      expect(w.reason.length).toBeGreaterThan(60);
      expect(new Date(w.expires).getTime()).toBeGreaterThan(Date.now());
    }
  });
});
