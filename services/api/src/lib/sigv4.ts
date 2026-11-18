import { createHash, createHmac } from 'node:crypto';

/**
 * AWS Signature Version 4 for S3-compatible object storage (Cloudflare R2). Written here instead of pulling in the AWS SDK:
 * FARM+ only needs PUT and DELETE of single objects, and every runtime dependency is held to the strict audit policy.
 * Reference: https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
 */
export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
}

export const sha256Hex = (data: string | Buffer): string =>
  createHash('sha256').update(data).digest('hex');

const hmac = (key: string | Buffer, data: string): Buffer =>
  createHmac('sha256', key).update(data, 'utf8').digest();

/** RFC 3986 encoding as S3 expects it (unreserved characters kept; everything else percent-encoded). */
const encodeRfc3986 = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** S3 encodes each path segment once (no double encoding). */
const canonicalUri = (url: URL): string =>
  url.pathname
    .split('/')
    .map((segment) => encodeRfc3986(decodeURIComponent(segment)))
    .join('/') || '/';

const canonicalQuery = (url: URL): string =>
  [...url.searchParams.entries()]
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)] as const)
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

const amzDate = (now: Date): string =>
  now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

/**
 * Returns the headers to send: the given ones plus `host`, `x-amz-date`, `x-amz-content-sha256` and `authorization`.
 * Every given header is signed.
 */
export function signRequest(input: {
  method: string;
  url: URL;
  headers?: Record<string, string>;
  payloadHash: string;
  credentials: SigV4Credentials;
  now?: Date;
}): Record<string, string> {
  const { method, url, payloadHash, credentials } = input;
  const stamp = amzDate(input.now ?? new Date());
  const day = stamp.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers ?? {}))
    headers[k.toLowerCase()] = v.trim().replace(/\s+/g, ' ');
  headers['host'] = url.host;
  headers['x-amz-date'] = stamp;
  headers['x-amz-content-sha256'] = payloadHash;

  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri(url),
    canonicalQuery(url),
    names.map((n) => `${n}:${headers[n]}\n`).join(''),
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${day}/${credentials.region}/${credentials.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(
    hmac(
      hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), credentials.region),
      credentials.service,
    ),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
