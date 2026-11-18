#!/usr/bin/env node
/**
 * Dependency vulnerability policy (run by CI; run it locally with `node scripts/qa/audit-policy.mjs`).
 *
 *  1. SERVER and WEB runtime (services/*, packages/*, apps/web — production dependencies): any advisory of severity
 *     moderate or higher FAILS. Nothing is waivable there.
 *  2. Everything else (mobile build tooling, e2e/dev tooling): critical/high FAIL unless waived in docs/qa/audit-waivers.json
 *     (reason + owner + expiry); moderate/low are reported but do not fail.
 *  3. An expired waiver fails, so exceptions cannot be forgotten.
 *
 * The raw `pnpm audit` is deliberately not used as the gate: it cannot say WHERE a vulnerable package is used, so it either
 * blocks every release on build-tool advisories nobody can fix, or gets ignored. This policy keeps the strict part strict.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RANK = { low: 1, moderate: 2, high: 3, critical: 4 };
const RUNTIME_IMPORTERS = /^(services__|packages__|apps__web)/;

export function evaluate(advisories, waivers, now = new Date()) {
  const failures = [];
  const notes = [];
  const waiverById = new Map(waivers.map((w) => [w.id, w]));
  for (const w of waivers)
    if (new Date(w.expires) < now)
      failures.push(
        `waiver ${w.id} (${w.package}) expired on ${w.expires}: re-review or remove it`,
      );
  for (const a of Object.values(advisories)) {
    const sev = RANK[a.severity] ?? 0;
    const importers = [...new Set(a.findings.flatMap((f) => f.paths.map((p) => p.split('>')[0])))];
    const runtime = importers.filter((i) => RUNTIME_IMPORTERS.test(i));
    const id = a.github_advisory_id;
    const line = `${a.severity.toUpperCase()} ${a.module_name}@${a.findings[0]?.version} (${id}) via ${importers.join(', ')}`;
    if (runtime.length && sev >= RANK.moderate) {
      failures.push(`${line} — in a server/web runtime dependency; upgrade it (not waivable)`);
    } else if (sev >= RANK.high) {
      const w = waiverById.get(id);
      if (!w) failures.push(`${line} — high/critical in tooling and not waived`);
      else notes.push(`${line} — waived until ${w.expires}: ${w.reason.slice(0, 90)}…`);
    } else notes.push(`${line} — below the failing threshold`);
  }
  return { failures, notes };
}

function runPnpm(args) {
  // `pnpm` on CI (pnpm/action-setup); locally it may only be reachable through corepack/npx at the pinned version.
  const pinned = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).packageManager?.split(
    '@',
  )[1];
  const candidates = [
    ['pnpm', args],
    ['npx', ['-y', `pnpm@${pinned}`, ...args]],
  ];
  let last;
  for (const [cmd, a] of candidates) {
    try {
      return execFileSync(cmd, a, {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch (error) {
      // pnpm exits non-zero when it finds vulnerabilities but still prints the JSON report
      if (error.stdout?.trim().startsWith('{')) return error.stdout;
      last = error;
    }
  }
  throw last;
}

const audit = (prod) => JSON.parse(runPnpm(['audit', ...(prod ? ['--prod'] : []), '--json']));

function main() {
  const waivers = JSON.parse(
    readFileSync(join(ROOT, 'docs/qa/audit-waivers.json'), 'utf8'),
  ).waivers;
  const merged = { ...audit(true).advisories, ...audit(false).advisories };
  const { failures, notes } = evaluate(merged, waivers);
  for (const n of notes) process.stdout.write(`note  ${n}\n`);
  for (const f of failures) process.stderr.write(`FAIL  ${f}\n`);
  process.stdout.write(`\n${Object.keys(merged).length} advisories, ${failures.length} failing\n`);
  process.exit(failures.length ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
