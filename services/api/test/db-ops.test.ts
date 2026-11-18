/* eslint-disable @typescript-eslint/no-explicit-any -- documents are inspected loosely in tests */
import { execFile } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog, Notification, Setting, User } from '../src/models';
import { notify } from '../src/modules/notifications/service';
import { createBackup, readManifest, restoreBackup, verifyBackup } from '../src/ops/backup';
import { checkIndexes } from '../src/ops/indexes';
import { planMigrations, runMigrations } from '../src/ops/migrations';
import type { Migration } from '../src/db/migrations';
import { createUser, startHarness, type TestHarness } from './helpers';

let h: TestHarness;
let db: mongoose.mongo.Db;
let dbCounter = 0;
const KEY = Buffer.alloc(32, 9).toString('base64');
const tmp = () => mkdtempSync(join(tmpdir(), 'farmplus-ops-'));
/** A fresh, empty database on the same server (a restore target). */
const freshDb = () => mongoose.connection.getClient().db(`restore_target_${++dbCounter}`);

beforeAll(async () => {
  h = await startHarness();
  db = mongoose.connection.db!;
  const a = await createUser(h.app);
  await createUser(h.app);
  await notify({ to: [a.id], type: 'order.placed', params: { orderNo: 'BK-1' }, eventKey: 'bk:1' });
  await Setting.updateOne(
    { key: 'analytics.cacheSeconds' },
    { $set: { value: 42 } },
    { upsert: true },
  );
  await db.collection('typed').insertOne({
    _id: new mongoose.Types.ObjectId(),
    when: new Date('2026-06-15T05:00:00.000Z'),
    money: mongoose.Types.Decimal128.fromString('12345.67'),
    big: BigInt(2) ** BigInt(40),
    nested: { list: [1, 'two', { three: true }], nothing: null },
    bin: Buffer.from([0, 1, 2, 255]),
    thai: 'วัวพันธุ์ดี — ✓',
  });
});
afterAll(async () => {
  await h.stop();
});

describe('index management', () => {
  it('reports a healthy database: nothing missing, nothing in conflict', async () => {
    const report = await checkIndexes();
    expect(report.missing).toEqual([]);
    expect(report.conflicts).toEqual([]);
    expect(report.collections).toBeGreaterThan(50);
  });

  it('finds a missing index, creates it only with apply, and is then clean', async () => {
    await db.collection('notifications').dropIndex('notif_event_unique');
    const dry = await checkIndexes();
    expect(dry.missing.map((m) => m.collection)).toContain('notifications');
    expect(await db.collection('notifications').indexExists('notif_event_unique')).toBe(false); // a dry run changes nothing
    const applied = await checkIndexes({ apply: true });
    expect(applied.created.map((m) => m.collection)).toContain('notifications');
    expect(await db.collection('notifications').indexExists('notif_event_unique')).toBe(true);
    expect((await checkIndexes()).missing).toEqual([]);
  });

  it('never drops an index it does not know about, even with apply', async () => {
    await db.collection('users').createIndex({ handMade: 1 }, { name: 'hand_made_index' });
    const report = await checkIndexes({ apply: true });
    expect(report.extra.map((e) => e.name)).toContain('hand_made_index');
    expect(await db.collection('users').indexExists('hand_made_index')).toBe(true);
    await db.collection('users').dropIndex('hand_made_index');
  });

  it('reports a definition conflict instead of "fixing" it, and leaves the existing index in place', async () => {
    await db.collection('notifications').dropIndex('notif_ttl');
    await db
      .collection('notifications')
      .createIndex({ createdAt: 1 }, { name: 'notif_ttl', expireAfterSeconds: 99 });
    const report = await checkIndexes({ apply: true });
    expect(report.conflicts.length).toBeGreaterThan(0);
    const kept = (await db.collection('notifications').indexes()).find(
      (i) => i.name === 'notif_ttl',
    );
    expect(kept?.expireAfterSeconds).toBe(99); // untouched: changing it is a reviewed migration, not an automatic step
    await db.collection('notifications').dropIndex('notif_ttl');
    await db
      .collection('notifications')
      .createIndex({ createdAt: 1 }, { name: 'notif_ttl', expireAfterSeconds: 180 * 24 * 3600 });
    expect((await checkIndexes()).conflicts).toEqual([]);
  });
});

describe('migrations', () => {
  const calls: string[] = [];
  const m = (id: string, up?: Migration['up']): Migration => ({
    id,
    description: `migration ${id}`,
    up:
      up ??
      (async ({ db: d }) => {
        calls.push(id);
        await d
          .collection('mig_marker')
          .updateOne({ _id: id } as never, { $set: { done: true } }, { upsert: true }); // idempotent
      }),
  });

  it('plans, applies in order, records, and does nothing on a second run', async () => {
    const list = [m('0002-b'), m('0001-a')];
    const plan = await planMigrations(db, list);
    expect(plan.pending.map((p) => p.id)).toEqual(['0002-b', '0001-a']);
    const result = await runMigrations(db, { migrations: list });
    expect(calls).toEqual(['0001-a', '0002-b']); // lexical order, not list order
    expect(result.pending).toEqual([]);
    expect(result.ran.map((r) => r.id)).toEqual(['0001-a', '0002-b']);
    const again = await runMigrations(db, { migrations: list });
    expect(again.ran).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(await db.collection('schema_migrations_lock').countDocuments()).toBe(0); // lock released
  });

  it('stops at the first failure, records nothing for it, and a fixed re-run continues', async () => {
    let broken = true;
    const list = [
      m('0003-ok'),
      m('0004-fails', async () => {
        if (broken) throw new Error('boom');
      }),
      m('0005-after'),
    ];
    await expect(runMigrations(db, { migrations: list })).rejects.toThrow('boom');
    const plan = await planMigrations(db, list);
    expect(plan.applied.map((a) => a.id)).toContain('0003-ok');
    expect(plan.pending.map((p) => p.id)).toEqual(['0004-fails', '0005-after']);
    expect(await db.collection('schema_migrations_lock').countDocuments()).toBe(0);
    broken = false;
    expect((await runMigrations(db, { migrations: list })).ran.map((r) => r.id)).toEqual([
      '0004-fails',
      '0005-after',
    ]);
  });

  it('refuses to run when an applied migration was edited, and reports a database that is ahead of the code', async () => {
    const edited: Migration = { ...m('0001-a'), description: 'edited after it ran' };
    await expect(runMigrations(db, { migrations: [edited, m('0099-new')] })).rejects.toThrow(
      /modified/,
    );
    expect(await db.collection('mig_marker').findOne({ _id: '0099-new' } as never)).toBeNull();
    const behind = await planMigrations(db, [m('0001-a')]);
    expect(behind.unknown).toEqual(expect.arrayContaining(['0002-b', '0003-ok']));
  });

  it('refuses to run concurrently with a live lock, and recovers from a stale one', async () => {
    const list = [m('0100-locked')];
    await db
      .collection('schema_migrations_lock')
      .insertOne({ _id: 'lock', expiresAt: new Date(Date.now() + 60_000) } as never);
    await expect(runMigrations(db, { migrations: list })).rejects.toThrow(/lock/);
    await db
      .collection('schema_migrations_lock')
      .updateOne({ _id: 'lock' } as never, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await runMigrations(db, { migrations: list })).ran).toHaveLength(1);
  });

  it('ships a baseline migration that changes nothing', async () => {
    const { MIGRATIONS } = await import('../src/db/migrations');
    expect(MIGRATIONS[0]!.id).toBe('0001-baseline');
    expect(new Set(MIGRATIONS.map((x) => x.id)).size).toBe(MIGRATIONS.length);
    expect([...MIGRATIONS.map((x) => x.id)].sort()).toEqual(MIGRATIONS.map((x) => x.id));
  });
});

describe('backup and restore', () => {
  const fingerprintOf = async (d: mongoose.mongo.Db, name: string) =>
    JSON.stringify(await d.collection(name).find({}).sort({ _id: 1 }).toArray(), (_k, v) =>
      typeof v === 'bigint' ? `${v}n` : v,
    );

  it('round-trips every collection exactly — same documents, same types, same indexes', async () => {
    const dir = tmp();
    const manifest = await createBackup(db, dir, { appVersion: 'test' });
    expect(manifest.collections.map((c) => c.name)).toEqual(
      expect.arrayContaining(['users', 'notifications', 'settings', 'typed']),
    );
    expect(manifest.collections.find((c) => c.name === 'users')!.count).toBe(
      await User.countDocuments(),
    );
    expect(manifest.collections.map((c) => c.name)).not.toContain('schema_migrations_lock');
    expect(await verifyBackup(dir)).toEqual({ ok: true, problems: [] });

    const target = freshDb();
    const result = await restoreBackup(target, dir);
    expect(result.verified).toBe(true);
    for (const c of manifest.collections) {
      expect(await target.collection(c.name).countDocuments(), c.name).toBe(c.count);
      expect(await fingerprintOf(target, c.name), c.name).toBe(await fingerprintOf(db, c.name));
    }
    const typed: any = await target.collection('typed').findOne({});
    expect(typed.when).toBeInstanceOf(Date);
    expect(String(typed.money)).toBe('12345.67');
    expect(typed.thai).toBe('วัวพันธุ์ดี — ✓');
    expect(Buffer.from(typed.bin.buffer ?? typed.bin)).toEqual(Buffer.from([0, 1, 2, 255]));
    // indexes came back, including unique and partial ones
    const src = (await db.collection('notifications').indexes()).map((i) => i.name).sort();
    const dst = (await target.collection('notifications').indexes()).map((i) => i.name).sort();
    expect(dst).toEqual(src);
    const unique = (await target.collection('notifications').indexes()).find(
      (i) => i.name === 'notif_event_unique',
    );
    expect(unique).toMatchObject({
      unique: true,
      partialFilterExpression: { eventKey: { $type: 'string' } },
    });
    await target.dropDatabase();
  });

  it('writes private files (0600 in a 0700 directory) and refuses to mix backups', async () => {
    const dir = join(tmp(), 'b');
    await createBackup(db, dir);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    for (const f of readdirSync(dir)) expect(statSync(join(dir, f)).mode & 0o777, f).toBe(0o600);
    await expect(createBackup(db, dir)).rejects.toThrow(/not empty/);
  });

  it('refuses to restore into a database that already has data, and changes nothing', async () => {
    const dir = tmp();
    await createBackup(db, dir);
    const target = freshDb();
    await target
      .collection('users')
      .insertOne({ _id: new mongoose.Types.ObjectId(), email: 'precious@example.test' } as never);
    await expect(restoreBackup(target, dir)).rejects.toThrow(/not empty/);
    expect(await target.collection('users').countDocuments()).toBe(1);
    expect(await target.collection('notifications').countDocuments()).toBe(0); // nothing was restored either
    await expect(restoreBackup(db, dir)).rejects.toThrow(/not empty/); // and certainly not over the live database
    await target.dropDatabase();
  });

  it('detects tampering and truncation before restoring anything', async () => {
    const dir = tmp();
    await createBackup(db, dir);
    const file = join(dir, 'users.ndjson');
    const original = readFileSync(file);
    chmodSync(file, 0o600);
    writeFileSync(file, original.toString('utf8').replace('"active"', '"hacked"'));
    const bad = await verifyBackup(dir);
    expect(bad.ok).toBe(false);
    expect(bad.problems.join()).toMatch(/users: checksum mismatch/);
    const target = freshDb();
    await expect(restoreBackup(target, dir)).rejects.toThrow(/failed verification/);
    expect(await target.collection('users').countDocuments()).toBe(0);
    writeFileSync(file, original.subarray(0, original.length - 20));
    expect((await verifyBackup(dir)).ok).toBe(false);
    writeFileSync(file, original);
    expect((await verifyBackup(dir)).ok).toBe(true);
    await target.dropDatabase();
  });

  it('encrypts with AES-256-GCM: no plaintext on disk, a wrong key or a flipped bit fails, the right key restores', async () => {
    const dir = tmp();
    const manifest = await createBackup(db, dir, { encryptionKey: KEY });
    expect(manifest.encrypted).toBe(true);
    const files = readdirSync(dir).filter((f) => f.endsWith('.enc'));
    expect(files.length).toBe(manifest.collections.length);
    const raw = readFileSync(join(dir, 'users.ndjson.enc')).toString('latin1');
    expect(raw).not.toContain('@example.test');
    expect(existsSync(join(dir, 'users.ndjson'))).toBe(false);
    expect((await verifyBackup(dir)).ok).toBe(false); // no key
    expect(
      (await verifyBackup(dir, { encryptionKey: Buffer.alloc(32, 1).toString('base64') })).ok,
    ).toBe(false); // wrong key
    const good = await verifyBackup(dir, { encryptionKey: KEY });
    expect(good.problems).toEqual([]);
    const file = join(dir, 'notifications.ndjson.enc');
    const bytes = readFileSync(file);
    bytes[20] = bytes[20]! ^ 1;
    writeFileSync(file, bytes);
    expect((await verifyBackup(dir, { encryptionKey: KEY })).ok).toBe(false);
    bytes[20] = bytes[20]! ^ 1;
    writeFileSync(file, bytes);
    const target = freshDb();
    expect((await restoreBackup(target, dir, { encryptionKey: KEY })).verified).toBe(true);
    expect(await target.collection('users').countDocuments()).toBe(await User.countDocuments());
    await target.dropDatabase();
    expect(() => verifyBackup(dir, { encryptionKey: 'short' })).rejects.toThrow(/32 bytes/);
  });

  it('streams large collections in batches (does not need them in memory) and restores the same count', async () => {
    const coll = db.collection('bulk');
    await coll.insertMany(
      Array.from({ length: 5000 }, (_, i) => ({
        _id: new mongoose.Types.ObjectId(),
        i,
        pad: 'x'.repeat(200),
      })),
    );
    const dir = tmp();
    const manifest = await createBackup(db, dir);
    expect((await readManifest(dir)).collections.find((c) => c.name === 'bulk')!.count).toBe(5000);
    expect(manifest.collections.find((c) => c.name === 'bulk')!.bytes).toBeGreaterThan(1_000_000);
    const target = freshDb();
    expect(
      (await restoreBackup(target, dir, { batchSize: 700 })).collections.find(
        (c) => c.name === 'bulk',
      )!.restored,
    ).toBe(5000);
    await target.dropDatabase();
    await coll.drop();
  });

  it('contains the audit trail and other collections too (nothing is silently skipped)', async () => {
    const dir = tmp();
    const manifest = await createBackup(db, dir);
    const names = manifest.collections.map((c) => c.name);
    expect(names).toContain(AuditLog.collection.name);
    expect(names).toContain(Notification.collection.name);
  });
});

describe('the db command line', () => {
  /** Async on purpose: a blocking spawn would freeze this process's own event loop while the CLI talks to MongoDB. */
  const cli = (args: string[], uri: string, extra: Record<string, string> = {}) =>
    new Promise<{ status: number; stdout: string; stderr: string }>((resolve) => {
      execFile(
        join(process.cwd(), 'node_modules/.bin/tsx'),
        ['src/scripts/db.ts', ...args],
        {
          cwd: process.cwd(),
          env: {
            PATH: process.env['PATH'] ?? '',
            NODE_ENV: 'development',
            MONGODB_URI: uri,
            ...extra,
          },
          timeout: 90_000,
        },
        (error, stdout, stderr) =>
          resolve({ status: error ? ((error as { code?: number }).code ?? 1) : 0, stdout, stderr }),
      );
    });
  const baseUri = () => h.env.MONGODB_URI.replace(/\/[^/?]+(\?|$)/, '/');

  it('dry-runs by default, and mutating commands need --confirm-db with the exact database name', async () => {
    const uri = `${baseUri()}farmplus_test`;
    const indexes = await cli(['indexes'], uri);
    expect(indexes.status, indexes.stderr).toBe(0);
    expect(JSON.parse(indexes.stdout)).toMatchObject({
      database: 'farmplus_test',
      apply: false,
      conflicts: [],
    });
    expect(indexes.stdout).not.toContain('mongodb://'); // never prints the connection string
    const noConfirm = await cli(['indexes', '--apply'], uri);
    expect(noConfirm.status).toBe(1);
    expect(noConfirm.stderr).toContain('--confirm-db farmplus_test');
    expect((await cli(['indexes', '--apply', '--confirm-db', 'other_db'], uri)).status).toBe(1);
    expect((await cli(['migrate', '--apply'], uri)).status).toBe(1);
    expect((await cli(['restore', tmp()], uri)).status).toBe(1);
    const dry = await cli(['migrate'], uri);
    expect(JSON.parse(dry.stdout)).toMatchObject({ apply: false, pending: expect.any(Array) });
    expect((await cli(['nonsense'], uri)).status).toBe(1);
  });

  it('backup → verify → restore into a new database works end to end, and restore refuses a database with data', async () => {
    const uri = `${baseUri()}farmplus_test`;
    const dir = join(tmp(), 'cli-backup');
    const backup = await cli(['backup', dir], uri, { BACKUP_ENCRYPTION_KEY: KEY });
    expect(backup.status, backup.stderr).toBe(0);
    expect(JSON.parse(backup.stdout)).toMatchObject({ database: 'farmplus_test', encrypted: true });
    expect((await cli(['verify-backup', dir], uri)).status).toBe(1); // no key → cannot verify
    expect((await cli(['verify-backup', dir], uri, { BACKUP_ENCRYPTION_KEY: KEY })).status).toBe(0);
    const target = `${baseUri()}cli_restore_target`;
    const restore = await cli(['restore', dir, '--confirm-db', 'cli_restore_target'], target, {
      BACKUP_ENCRYPTION_KEY: KEY,
    });
    expect(restore.status, restore.stderr).toBe(0);
    expect(JSON.parse(restore.stdout).verified).toBe(true);
    const again = await cli(['restore', dir, '--confirm-db', 'cli_restore_target'], target, {
      BACKUP_ENCRYPTION_KEY: KEY,
    });
    expect(again.status).toBe(1);
    expect(again.stderr).toMatch(/not empty/);
    const live = await cli(['restore', dir, '--confirm-db', 'farmplus_test'], uri, {
      BACKUP_ENCRYPTION_KEY: KEY,
    });
    expect(live.status).toBe(1); // the live database has data
  });

  it('production rules apply to the connection string of maintenance jobs too', async () => {
    const res = await cli(['indexes'], 'mongodb://u:p@127.0.0.1:27017/farmplus', {
      NODE_ENV: 'production',
      DEPLOY_ENV: 'staging',
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/must use TLS|localhost/);
    expect(res.stderr).not.toContain(':p@');
  });
});
