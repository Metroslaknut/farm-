import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(process.cwd(), '..', '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', '.expo', 'coverage', '.git', 'build']);

function walk(dir: string, accept: (file: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, accept, out);
    else if (accept(full)) out.push(full);
  }
  return out;
}
const rel = (f: string) => relative(ROOT, f);
const read = (f: string) => readFileSync(f, 'utf8');
const SRC = /\.(ts|tsx|mjs|js)$/;
const sourceOf = (sub: string) => walk(join(ROOT, sub), (f) => SRC.test(f) && !f.endsWith('.d.ts'));

/** Returns "file:line: text" for every line of `files` matching `re`. */
function grep(files: string[], re: RegExp): string[] {
  const hits: string[] = [];
  for (const f of files)
    read(f)
      .split('\n')
      .forEach((line, i) => {
        if (re.test(line)) hits.push(`${rel(f)}:${i + 1}: ${line.trim().slice(0, 140)}`);
      });
  return hits;
}

describe('XSS: no raw HTML or code execution sinks in the clients', () => {
  const clients = [
    ...sourceOf('apps/web/src'),
    ...sourceOf('apps/mobile/src'),
    ...sourceOf('apps/mobile/app'),
  ];
  it('never injects HTML or evaluates strings', () => {
    expect(
      grep(
        clients,
        /dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write\(|\beval\(|new Function\(|setTimeout\(\s*['"`]/,
      ),
    ).toEqual([]);
  });
  it('mobile WebViews (if any) never run injected scripts', () => {
    expect(
      grep(
        sourceOf('apps/mobile/src').concat(sourceOf('apps/mobile/app')),
        /injectedJavaScript|javaScriptEnabled\s*=\s*\{?true/,
      ),
    ).toEqual([]);
  });
  it('every link that opens a new tab disables window.opener', () => {
    const bad = grep(sourceOf('apps/web/src'), /target="_blank"/).filter(
      (l) => !/noopener/.test(l),
    );
    // the rel attribute may be on the next line: check the whole tag
    const real = bad.filter((l) => {
      const [file, line] = l.split(':');
      const lines = read(join(ROOT, file!)).split('\n');
      return !/noopener/.test(lines.slice(Number(line) - 2, Number(line) + 2).join(' '));
    });
    expect(real).toEqual([]);
  });
});

describe('injection: every URL the API accepts from a user must be https', () => {
  it('each z.url() in the validation package restricts the protocol', () => {
    const files = sourceOf('packages/validation/src');
    const urls = grep(files, /z\.url\(/);
    expect(urls.length).toBeGreaterThanOrEqual(5);
    const loose = urls.filter((l) => !/protocol:\s*\/\^https\$\//.test(l));
    expect(loose).toEqual([]);
  });
  it('no query is built from raw request data (no $where / $function / string-built filters)', () => {
    // Mongoose uses this fixed, server-derived document predicate for revision compare-and-set.
    // It is not a Mongo query assembled from request input; keep every other query-code sink blocked.
    const queryCode = grep(
      sourceOf('services/api/src'),
      /\$where|\$function|\$accumulator|mapReduce|\.eval\(/,
    ).filter((line) => !/record-core\.ts:\d+: \(doc as any\)\.\$where = \{ revision: readRevision \}/.test(line));
    expect(
      queryCode,
    ).toEqual([]);
  });
  it('the API never spawns processes or evaluates code', () => {
    const hits = grep(
      sourceOf('services/api/src').filter((f) => !f.includes('/scripts/')),
      /child_process|(^|[^.\w])(exec|execSync|execFile|spawn|fork)\(|\bvm\.|new Function\(|\beval\(/,
    );
    expect(hits).toEqual([]);
  });
});

describe('CSRF: tokens travel only in the Authorization header', () => {
  it('the server never sets or reads cookies', () => {
    expect(
      grep(
        sourceOf('services/api/src'),
        /res\.cookie\(|cookie-parser|req\.cookies|set-cookie|credentials:\s*true/i,
      ),
    ).toEqual([]);
  });
  it('the web client keeps tokens in memory and sessionStorage only — never localStorage or cookies', () => {
    const web = sourceOf('apps/web/src');
    expect(grep(web, /document\.cookie/)).toEqual([]);
    const storage = grep(web, /localStorage\.(set|get)Item/).filter((l) =>
      /token|auth|refresh|session|password/i.test(l),
    );
    expect(storage).toEqual([]);
  });
});

describe('TLS verification is never switched off', () => {
  it('no code, workflow or script disables certificate verification', () => {
    const files = [
      ...sourceOf('services'),
      ...sourceOf('apps'),
      ...sourceOf('packages'),
      ...sourceOf('scripts'),
      ...walk(join(ROOT, '.github'), () => true),
      ...walk(join(ROOT, 'deploy'), () => true),
    ].filter((f) => !f.includes('/test/'));
    const hits = grep(
      files,
      /NODE_TLS_REJECT_UNAUTHORIZED|rejectUnauthorized:\s*false|tlsInsecure=true|tlsAllowInvalid(Certificates|Hostnames)=true|curl\s+(-k|--insecure)|--insecure|strict-ssl\s*false/,
    );
    // the only legitimate mentions are the production-validation rules that REFUSE these settings
    expect(
      hits.filter(
        (l) => !l.includes('packages/config/src/server.ts') && !l.includes('INSECURE_TLS'),
      ),
    ).toEqual([]);
  });
});

describe('secrets are not in the repository', () => {
  const PATTERNS: [string, RegExp][] = [
    ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
    ['Anthropic/OpenAI style key', /\bsk-(ant|proj|live)-[A-Za-z0-9_-]{20,}/],
    ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
    ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
    ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
    ['JWT', /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/],
    [
      'connection string with a password',
      /mongodb(\+srv)?:\/\/[A-Za-z0-9_.-]+:(?!<|\$\{|%s|password|PASSWORD|xxx|\*\*\*)[^\s@/'"`]{6,}@/,
    ],
  ];
  /** Files that deliberately contain FAKE credentials: unit-test fixtures. */
  const FIXTURES = /(^|\/)(test|tests)\//;
  const files = walk(
    ROOT,
    (f) =>
      !/\.(png|jpg|jpeg|gif|ico|woff2?|lock|tgz|map)$/.test(f) &&
      !f.endsWith('pnpm-lock.yaml') &&
      statSync(f).size < 1_000_000,
  );

  it('no real credential pattern appears outside test fixtures', () => {
    const hits: string[] = [];
    for (const f of files) {
      if (FIXTURES.test(rel(f)) || rel(f).startsWith('docs/')) continue;
      const text = read(f);
      for (const [name, re] of PATTERNS) if (re.test(text)) hits.push(`${rel(f)}: ${name}`);
    }
    expect(hits).toEqual([]);
  });

  it('test fixtures use only obviously fake credentials (no real-looking provider tokens)', () => {
    const hits: string[] = [];
    for (const f of files.filter((x) => FIXTURES.test(rel(x)))) {
      const text = read(f);
      for (const [name, re] of PATTERNS.filter(
        ([n]) => n !== 'connection string with a password' && n !== 'JWT',
      )) {
        const found = text.match(new RegExp(re.source, 'g')) ?? [];
        // a fixture is fine when it says so: "sk-ant-test-key-…", "…fake…", "…example…"
        for (const token of found)
          if (!/test|fake|example|dummy|placeholder/i.test(token)) hits.push(`${rel(f)}: ${name}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('.env.example (and the deployment templates) carry no values for secret variables', () => {
    for (const file of ['.env.example', ...walk(join(ROOT, 'deploy/env'), () => true).map(rel)]) {
      for (const line of read(join(ROOT, file)).split('\n')) {
        const m =
          /^([A-Z0-9_]*(SECRET|TOKEN|API_KEY|PASSWORD|ENCRYPTION_KEY|MONGODB_URI)[A-Z0-9_]*)=(.*)$/.exec(
            line,
          );
        if (!m || /_TTL_|_TOKENS$/.test(m[1]!)) continue;
        expect(['', '<secret>'], `${file}: ${m[1]}`).toContain(m[3]!.trim());
      }
    }
  });

  it('real environment files are git-ignored', () => {
    const ignore = read(join(ROOT, '.gitignore'));
    expect(ignore).toMatch(/^\.env$/m);
    expect(ignore).toMatch(/^\.env\.\*$/m);
  });
});
