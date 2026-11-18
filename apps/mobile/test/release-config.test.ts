import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import config, { releaseConfigProblems } from '../app.config';

const good = {
  EAS_BUILD_PROFILE: 'production',
  EXPO_PUBLIC_API_BASE_URL: 'https://api.example.com',
  EAS_PROJECT_ID: '11111111-2222-3333-4444-555555555555',
};

describe('release build configuration', () => {
  it('only constrains release builds: development stays frictionless', () => {
    expect(releaseConfigProblems({})).toEqual([]);
    expect(releaseConfigProblems({ EAS_BUILD_PROFILE: 'development' })).toEqual([]);
    expect(
      releaseConfigProblems({
        EAS_BUILD_PROFILE: 'preview',
        EXPO_PUBLIC_API_BASE_URL: 'http://staging.local',
      }),
    ).toEqual([]);
  });

  it('a production build needs an https API URL and a project id', () => {
    expect(releaseConfigProblems(good)).toEqual([]);
    expect(releaseConfigProblems({ ...good, EXPO_PUBLIC_API_BASE_URL: undefined }).join()).toMatch(
      /required/,
    );
    expect(
      releaseConfigProblems({ ...good, EXPO_PUBLIC_API_BASE_URL: 'http://api.example.com' }).join(),
    ).toMatch(/https/);
    for (const local of [
      'https://localhost:4000',
      'https://10.0.2.2:4000',
      'https://192.168.1.5:4000',
    ])
      expect(
        releaseConfigProblems({ ...good, EXPO_PUBLIC_API_BASE_URL: local }).join(),
        local,
      ).toMatch(/local address/);
    expect(releaseConfigProblems({ ...good, EAS_PROJECT_ID: '' }).join()).toMatch(/EAS_PROJECT_ID/);
    expect(releaseConfigProblems({ FARMPLUS_RELEASE: 'true' }).length).toBe(2);
  });

  it('the Expo config fails the build on a bad release configuration and carries the project id otherwise', () => {
    const saved = { ...process.env };
    try {
      Object.assign(process.env, {
        EAS_BUILD_PROFILE: 'production',
        EXPO_PUBLIC_API_BASE_URL: 'http://insecure.example.com',
        EAS_PROJECT_ID: good.EAS_PROJECT_ID,
      });
      expect(() =>
        config({
          config: { name: 'FARM+', slug: 'farm-plus' },
          projectRoot: '',
          staticConfigPath: null,
          packageJsonPath: null,
        } as never),
      ).toThrow(/https/);
      process.env['EXPO_PUBLIC_API_BASE_URL'] = 'https://api.example.com';
      const built = config({
        config: { name: 'FARM+', slug: 'farm-plus' },
        projectRoot: '',
        staticConfigPath: null,
        packageJsonPath: null,
      } as never);
      expect(built.extra?.['eas']).toEqual({ projectId: good.EAS_PROJECT_ID });
      expect(built.runtimeVersion).toEqual({ policy: 'appVersion' });
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });
});

describe('eas.json', () => {
  const eas = JSON.parse(readFileSync(resolve(__dirname, '../eas.json'), 'utf8'));
  it('has development, preview and production profiles; the production profile builds a store bundle with remote versioning', () => {
    expect(Object.keys(eas.build)).toEqual(
      expect.arrayContaining(['development', 'preview', 'production']),
    );
    expect(eas.cli.appVersionSource).toBe('remote');
    expect(eas.build.production).toMatchObject({
      distribution: 'store',
      autoIncrement: true,
      android: { buildType: 'app-bundle' },
      environment: 'production',
    });
    expect(eas.build.development.developmentClient).toBe(true);
    expect(eas.build.preview.distribution).toBe('internal');
  });
  it('contains no credentials, key files or URLs (those live in EAS)', () => {
    const text = JSON.stringify(eas);
    expect(text).not.toMatch(
      /serviceAccountKeyPath|\.json"|\.p8|\.p12|keystore|password|secret|token|https?:\/\//i,
    );
  });
});
