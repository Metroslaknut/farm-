import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, open, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import mongoose from 'mongoose';

type Db = mongoose.mongo.Db;
type Document = mongoose.mongo.Document;
const { EJSON } = mongoose.mongo.BSON;

/**
 * Logical backup/restore for FARM+ (in addition to Atlas' own cloud backups, which are the primary mechanism — see
 * docs/ops/backup-restore.md). One NDJSON file per collection (canonical Extended JSON, so ObjectIds, dates and
 * decimals survive), the index definitions, and a manifest with per-file SHA-256 and counts.
 *
 * Safety rules, enforced in code:
 *  - restore only into an EMPTY target and never drops, deletes or overwrites anything;
 *  - files are written 0600 in a 0700 directory, and can be encrypted with AES-256-GCM (backups hold personal and
 *    financial data, hashed credentials and encrypted MFA secrets);
 *  - every backup is verified (checksums) before a restore, and every restore is verified (re-hash) after.
 */
export const BACKUP_FORMAT = 1;

export interface ManifestCollection {
  name: string;
  count: number;
  /** SHA-256 of the plaintext NDJSON. */
  sha256: string;
  bytes: number;
  indexes: Document[];
}
export interface Manifest {
  format: number;
  createdAt: string;
  database: string;
  appVersion: string | null;
  encrypted: boolean;
  collections: ManifestCollection[];
}

const SKIP = new Set(['schema_migrations_lock']); // transient lock, never part of a backup
const isSystem = (name: string) => name.startsWith('system.');
const ENC_IV = 12;
const ENC_TAG = 16;

function cipherKey(key: string | undefined): Buffer | null {
  if (!key) return null;
  const buf = Buffer.from(key, 'base64');
  if (buf.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY must be 32 bytes, base64 encoded');
  return buf;
}

/** Stream a collection (in _id order, so the hash is stable) to `file`; returns count, bytes and the plaintext hash. */
async function exportCollection(
  db: Db,
  name: string,
  file: string,
  key: Buffer | null,
): Promise<{ count: number; sha256: string; bytes: number }> {
  const hash = createHash('sha256');
  let count = 0;
  let bytes = 0;
  const cursor = db.collection(name).find({}, { sort: { _id: 1 } });
  async function* lines(): AsyncGenerator<Buffer> {
    for await (const doc of cursor) {
      const line = Buffer.from(`${EJSON.stringify(doc, { relaxed: false })}\n`);
      hash.update(line);
      count++;
      bytes += line.length;
      yield line;
    }
  }
  const out = createWriteStream(file, { mode: 0o600 });
  if (!key) {
    await pipeline(lines(), out);
  } else {
    const iv = randomBytes(ENC_IV);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    out.write(iv);
    await pipeline(
      lines(),
      cipher,
      async function* (source) {
        for await (const chunk of source) yield chunk as Buffer;
        yield cipher.getAuthTag();
      },
      out,
    );
  }
  return { count, sha256: hash.digest('hex'), bytes };
}

/** Yield the plaintext NDJSON of a backup file (decrypting if needed). A wrong key or any corruption throws. */
async function* readPlain(file: string, key: Buffer | null): AsyncGenerator<Buffer> {
  if (!key) {
    for await (const chunk of createReadStream(file)) yield chunk as Buffer;
    return;
  }
  const size = (await stat(file)).size;
  if (size < ENC_IV + ENC_TAG) throw new Error(`${file}: too short to be an encrypted backup file`);
  const handle = await open(file, 'r');
  const iv = Buffer.alloc(ENC_IV);
  const tag = Buffer.alloc(ENC_TAG);
  await handle.read(iv, 0, ENC_IV, 0);
  await handle.read(tag, 0, ENC_TAG, size - ENC_TAG);
  await handle.close();
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  // GCM authenticates at the end: plaintext is released only chunk-by-chunk, so callers must treat the whole read
  // as failed if it throws (restore reads into memory-bounded batches and verifies the hash afterwards too).
  if (size === ENC_IV + ENC_TAG) {
    decipher.final(); // an empty collection: nothing to read, but the authentication tag must still check out
    return;
  }
  yield* createReadStream(file, { start: ENC_IV, end: size - ENC_TAG - 1 }).pipe(
    decipher,
  ) as AsyncIterable<Buffer> as AsyncGenerator<Buffer>;
}

async function* documentsOf(
  file: string,
  key: Buffer | null,
): AsyncGenerator<{ doc: Document; line: Buffer }> {
  let pending = '';
  for await (const chunk of readPlain(file, key)) {
    pending += chunk.toString('utf8');
    let idx: number;
    while ((idx = pending.indexOf('\n')) >= 0) {
      const text = pending.slice(0, idx);
      pending = pending.slice(idx + 1);
      if (text)
        yield {
          doc: EJSON.parse(text, { relaxed: false }) as Document,
          line: Buffer.from(`${text}\n`),
        };
    }
  }
  if (pending.trim()) throw new Error(`${file}: truncated last line`);
}

export async function createBackup(
  db: Db,
  dir: string,
  options: { encryptionKey?: string | undefined; appVersion?: string | undefined } = {},
): Promise<Manifest> {
  const key = cipherKey(options.encryptionKey);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  if ((await readdir(dir)).length > 0)
    throw new Error(`${dir} is not empty: refusing to mix backups`);
  const infos = (await db.listCollections({ type: 'collection' }).toArray()).filter(
    (c) => !isSystem(c.name) && !SKIP.has(c.name),
  );
  const collections: ManifestCollection[] = [];
  for (const info of infos.sort((a, b) => a.name.localeCompare(b.name))) {
    const result = await exportCollection(
      db,
      info.name,
      join(dir, `${info.name}.ndjson${key ? '.enc' : ''}`),
      key,
    );
    const indexes = (await db.collection(info.name).indexes()).filter((i) => i.name !== '_id_');
    collections.push({ name: info.name, ...result, indexes: indexes as Document[] });
  }
  const manifest: Manifest = {
    format: BACKUP_FORMAT,
    createdAt: new Date().toISOString(),
    database: db.databaseName,
    appVersion: options.appVersion ?? null,
    encrypted: Boolean(key),
    collections,
  };
  await writeFile(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });
  return manifest;
}

export async function readManifest(dir: string): Promise<Manifest> {
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as Manifest;
  if (manifest.format !== BACKUP_FORMAT)
    throw new Error(`Unsupported backup format ${String(manifest.format)}`);
  return manifest;
}

const fileOf = (dir: string, m: Manifest, c: ManifestCollection) =>
  join(dir, `${c.name}.ndjson${m.encrypted ? '.enc' : ''}`);

export interface VerifyResult {
  ok: boolean;
  problems: string[];
}

/** Re-read every file, check the authentication tag (encrypted) and compare hash and count with the manifest. */
export async function verifyBackup(
  dir: string,
  options: { encryptionKey?: string | undefined } = {},
): Promise<VerifyResult> {
  const manifest = await readManifest(dir);
  const key = cipherKey(options.encryptionKey);
  const problems: string[] = [];
  if (manifest.encrypted && !key)
    return { ok: false, problems: ['backup is encrypted: BACKUP_ENCRYPTION_KEY is required'] };
  for (const c of manifest.collections) {
    try {
      const hash = createHash('sha256');
      let count = 0;
      for await (const { line } of documentsOf(
        fileOf(dir, manifest, c),
        manifest.encrypted ? key : null,
      )) {
        hash.update(line);
        count++;
      }
      if (count !== c.count)
        problems.push(`${c.name}: ${count} documents, manifest says ${c.count}`);
      if (hash.digest('hex') !== c.sha256) problems.push(`${c.name}: checksum mismatch`);
    } catch (error) {
      problems.push(`${c.name}: ${(error as Error).message}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

export interface RestoreResult {
  collections: { name: string; restored: number; indexes: number }[];
  verified: boolean;
}

/**
 * Restore into `target`. REFUSES unless every collection in the backup is empty or absent in the target — it never
 * deletes, drops or overwrites. Verifies the backup first and re-hashes what it wrote afterwards.
 */
export async function restoreBackup(
  target: Db,
  dir: string,
  options: { encryptionKey?: string | undefined; batchSize?: number } = {},
): Promise<RestoreResult> {
  const manifest = await readManifest(dir);
  const key = cipherKey(options.encryptionKey);
  const check = await verifyBackup(dir, { encryptionKey: options.encryptionKey });
  if (!check.ok) throw new Error(`Backup failed verification: ${check.problems.join('; ')}`);

  for (const c of manifest.collections) {
    if (
      (await target.collection(c.name).estimatedDocumentCount()) > 0 ||
      (await target.collection(c.name).findOne({}))
    ) {
      throw new Error(
        `Target database is not empty (${c.name} has documents). Restore into a new, empty database; nothing was changed.`,
      );
    }
  }
  const result: RestoreResult = { collections: [], verified: false };
  const batch = options.batchSize ?? 1000;
  for (const c of manifest.collections) {
    const coll = target.collection(c.name);
    let buffer: Document[] = [];
    let restored = 0;
    const flush = async () => {
      if (buffer.length === 0) return;
      await coll.insertMany(buffer, { ordered: true });
      restored += buffer.length;
      buffer = [];
    };
    for await (const { doc } of documentsOf(
      fileOf(dir, manifest, c),
      manifest.encrypted ? key : null,
    )) {
      buffer.push(doc);
      if (buffer.length >= batch) await flush();
    }
    await flush();
    // Indexes after the data (faster, and unique indexes then also prove the data is consistent).
    for (const index of c.indexes) {
      const { key: spec, name, ...rest } = index as Document;
      delete rest['v']; // server-assigned, not part of the definition
      delete rest['ns'];
      await coll.createIndex(spec as never, { ...rest, name } as never);
    }
    result.collections.push({ name: c.name, restored, indexes: c.indexes.length });
  }
  // Round-trip proof: export what is now in the target and compare each hash with the manifest.
  let verified = true;
  for (const c of manifest.collections) {
    const hash = createHash('sha256');
    let count = 0;
    for await (const doc of target.collection(c.name).find({}, { sort: { _id: 1 } })) {
      hash.update(Buffer.from(`${EJSON.stringify(doc, { relaxed: false })}\n`));
      count++;
    }
    if (count !== c.count || hash.digest('hex') !== c.sha256) verified = false;
  }
  result.verified = verified;
  if (!verified)
    throw new Error('Restore finished but the restored data does not match the backup checksums');
  return result;
}
