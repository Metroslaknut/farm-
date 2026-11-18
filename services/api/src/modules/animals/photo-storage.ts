import type { ApiEnv } from '@farmplus/config/server';
import { HttpError } from '../../lib/errors';
import { sha256Hex, signRequest, type SigV4Credentials } from '../../lib/sigv4';

/**
 * Object storage for photos uploaded from a device (`PHOTO_STORAGE=r2`). Upload still goes through the API, which checks
 * the size and sniffs the image type; the object is then written to the bucket and served from its public domain under
 * an unguessable key, exactly like the database-backed `/api/v1/animal-photos/<key>` URLs. `null` (PHOTO_STORAGE=database)
 * keeps the bytes in MongoDB.
 */
export interface PhotoStorage {
  /** Public URL of a stored photo. */
  urlFor(key: string): string;
  /** The key of a URL this storage serves, or null when the URL is not one of its photos. */
  keyOf(url: string): string | null;
  put(key: string, bytes: Buffer, mimeType: string): Promise<void>;
  /** Deleting a missing object is not an error. */
  remove(key: string): Promise<void>;
}

const PREFIX = 'animal-photos/';
const TIMEOUT_MS = 15_000;

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
}

export class R2PhotoStorage implements PhotoStorage {
  private readonly credentials: SigV4Credentials;
  private readonly endpoint: string;

  constructor(
    private readonly config: R2Config,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.credentials = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: 'auto',
      service: 's3',
    };
    this.endpoint = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}/`;
  }

  urlFor(key: string): string {
    return `${this.config.publicBaseUrl}/${PREFIX}${key}`;
  }

  keyOf(url: string): string | null {
    const base = `${this.config.publicBaseUrl}/${PREFIX}`;
    return url.startsWith(base) ? url.slice(base.length) : null;
  }

  async put(key: string, bytes: Buffer, mimeType: string): Promise<void> {
    const res = await this.send('PUT', key, bytes, {
      'content-type': mimeType,
      // The key is a capability and the bytes never change; a deleted photo may stay in edge caches up to a day.
      'cache-control': 'public, max-age=86400, immutable',
    });
    if (!res.ok) throw unavailable(`PUT ${res.status}`);
  }

  async remove(key: string): Promise<void> {
    const res = await this.send('DELETE', key);
    if (!res.ok && res.status !== 404) throw unavailable(`DELETE ${res.status}`);
  }

  private async send(
    method: 'PUT' | 'DELETE',
    key: string,
    body?: Buffer,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    const url = new URL(`${this.endpoint}${PREFIX}${key}`);
    const signed = signRequest({
      method,
      url,
      headers,
      payloadHash: sha256Hex(body ?? ''),
      credentials: this.credentials,
    });
    try {
      return await this.fetchImpl(url, {
        method,
        headers: signed,
        ...(body ? { body: new Uint8Array(body) } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw unavailable(error instanceof Error ? error.name : 'network error');
    }
  }
}

/** The status detail is for logs only; clients get a stable code. Credentials never appear in messages. */
const unavailable = (detail: string) =>
  Object.assign(
    new HttpError(
      503,
      'PHOTO_STORAGE_UNAVAILABLE',
      'Photo storage is unavailable, please try again',
    ),
    { detail },
  );

export function createPhotoStorage(env: ApiEnv): PhotoStorage | null {
  if (env.PHOTO_STORAGE !== 'r2') return null;
  // Presence is guaranteed by the env validation (required when PHOTO_STORAGE=r2).
  return new R2PhotoStorage({
    accountId: env.R2_ACCOUNT_ID!,
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    bucket: env.R2_BUCKET!,
    publicBaseUrl: env.R2_PUBLIC_BASE_URL!,
  });
}
