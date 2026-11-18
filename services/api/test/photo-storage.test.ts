import { describe, expect, it, vi } from 'vitest';
import { sha256Hex, signRequest } from '../src/lib/sigv4';
import { R2PhotoStorage, createPhotoStorage } from '../src/modules/animals/photo-storage';
import { testEnv } from './helpers';

describe('SigV4 signing', () => {
  it('matches the AWS S3 documentation example (GET Object with a Range header)', () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html — "Example: GET Object"
    const headers = signRequest({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      headers: { Range: 'bytes=0-9' },
      payloadHash: sha256Hex(''),
      credentials: {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        region: 'us-east-1',
        service: 's3',
      },
      now: new Date('2013-05-24T00:00:00Z'),
    });
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
    expect(headers['x-amz-date']).toBe('20130524T000000Z');
  });
});

describe('R2 photo storage', () => {
  const config = {
    accountId: 'acc123',
    accessKeyId: 'AKTEST',
    secretAccessKey: 'r2-secret-value',
    bucket: 'farmplus-photos',
    publicBaseUrl: 'https://photos.example.com',
  };
  const key = 'c'.repeat(48);
  const storage = (status: number) => {
    const fetchImpl = vi.fn(async () => new Response(null, { status }));
    return { fetchImpl, store: new R2PhotoStorage(config, fetchImpl as unknown as typeof fetch) };
  };

  it('PUTs the bytes to the bucket, signed, with the sniffed type and a cache header', async () => {
    const { fetchImpl, store } = storage(200);
    const bytes = Buffer.from('image-bytes');
    await store.put(key, bytes, 'image/jpeg');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe(
      `https://acc123.r2.cloudflarestorage.com/farmplus-photos/animal-photos/${key}`,
    );
    const headers = init.headers as Record<string, string>;
    expect(init.method).toBe('PUT');
    expect(headers['content-type']).toBe('image/jpeg');
    expect(headers['cache-control']).toContain('max-age=86400');
    expect(headers['x-amz-content-sha256']).toBe(sha256Hex(bytes));
    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKTEST\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect(JSON.stringify(init)).not.toContain(config.secretAccessKey);
  });

  it('maps public URLs to keys and back', () => {
    const { store } = storage(200);
    expect(store.urlFor(key)).toBe(`https://photos.example.com/animal-photos/${key}`);
    expect(store.keyOf(store.urlFor(key))).toBe(key);
    expect(store.keyOf('https://cdn.example.com/animal-photos/x')).toBeNull();
    expect(store.keyOf(`/api/v1/animal-photos/${key}`)).toBeNull();
  });

  it('a refused upload or a failed delete is a 503 with a stable code; deleting a missing object is fine', async () => {
    await expect(storage(403).store.put(key, Buffer.from('x'), 'image/png')).rejects.toMatchObject({
      status: 503,
      code: 'PHOTO_STORAGE_UNAVAILABLE',
    });
    await expect(storage(500).store.remove(key)).rejects.toMatchObject({ status: 503 });
    await expect(storage(404).store.remove(key)).resolves.toBeUndefined();
    const { fetchImpl, store } = storage(204);
    await store.remove(key);
    expect((fetchImpl.mock.calls[0] as unknown as [URL, RequestInit])[1].method).toBe('DELETE');
  });

  it('a network failure is a 503 too', async () => {
    const store = new R2PhotoStorage(config, (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch);
    await expect(store.put(key, Buffer.from('x'), 'image/png')).rejects.toMatchObject({
      code: 'PHOTO_STORAGE_UNAVAILABLE',
    });
  });
});

describe('PHOTO_STORAGE configuration', () => {
  const env = (over: Record<string, string> = {}) =>
    testEnv('mongodb://127.0.0.1:27017/farmplus_test', over);

  it('defaults to the database (no storage adapter)', () => {
    expect(createPhotoStorage(env())).toBeNull();
  });

  it('r2 requires the account, keys, bucket and public URL', () => {
    expect(() => env({ PHOTO_STORAGE: 'r2' })).toThrow(/R2_ACCOUNT_ID[\s\S]*R2_PUBLIC_BASE_URL/);
    const r2 = env({
      PHOTO_STORAGE: 'r2',
      R2_ACCOUNT_ID: 'acc',
      R2_ACCESS_KEY_ID: 'id',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_BUCKET: 'bucket',
      R2_PUBLIC_BASE_URL: 'https://photos.example.com/',
    });
    expect(r2.R2_PUBLIC_BASE_URL).toBe('https://photos.example.com');
    expect(createPhotoStorage(r2)).toBeInstanceOf(R2PhotoStorage);
  });
});
