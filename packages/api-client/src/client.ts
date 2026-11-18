import { API_PREFIX } from '@farmplus/config';
import type {
  AuthTokens,
  AuthenticatedResponse,
  HealthResponse,
  LoginResponse,
  MyAccessResponse,
  PublicUser,
} from '@farmplus/shared-types';
import { trimTrailingSlashes } from '@farmplus/shared-utils';
import {
  apiErrorResponseSchema,
  authenticatedResponseSchema,
  healthResponseSchema,
  loginResponseSchema,
  myAccessResponseSchema,
  refreshResponseSchema,
  registerResponseSchema,
  type LoginInput,
  type RegisterInput,
} from '@farmplus/validation';
import type { ZodType } from 'zod';

export interface ApiClientOptions {
  /** Origin of the API, e.g. `http://localhost:4000`. Empty string = same origin (proxy). */
  baseUrl: string;
  fetch?: typeof fetch;
  /**
   * Supplies the current access token for authenticated calls. Token storage and refresh scheduling
   * are the app's responsibility (secure storage on Mobile); the client only attaches the header.
   */
  getAccessToken?: () => string | null | undefined | Promise<string | null | undefined>;
  /**
   * Called once when an authenticated request gets 401. Return true if the app obtained a fresh access
   * token (e.g. by refreshing) and the request should be retried.
   */
  onUnauthorized?: () => Promise<boolean>;
}

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  query?: Record<string, QueryValue>;
  body?: unknown;
  signal?: AbortSignal | undefined;
  /** Extra request headers, e.g. `Idempotency-Key` for money-moving calls. Never `Authorization`. */
  headers?: Record<string, string>;
}

/** Social sign-in providers the API may offer. */
export type OAuthProviderId = 'google' | 'facebook';

export interface ApiClient {
  getHealth(signal?: AbortSignal): Promise<HealthResponse>;
  register(input: RegisterInput, signal?: AbortSignal): Promise<PublicUser>;
  login(input: LoginInput, signal?: AbortSignal): Promise<LoginResponse>;
  verifyMfa(mfaToken: string, code: string, signal?: AbortSignal): Promise<AuthenticatedResponse>;
  refresh(refreshToken: string, signal?: AbortSignal): Promise<AuthTokens>;
  logout(signal?: AbortSignal): Promise<void>;
  getMyAccess(signal?: AbortSignal): Promise<MyAccessResponse>;
  /** Social sign-in providers configured on the API (empty when none). */
  oauthProviders(signal?: AbortSignal): Promise<OAuthProviderId[]>;
  /**
   * Where to send the browser (or the in-app auth session) to start a social sign-in. `returnTo` must be one of the
   * API's OAUTH_RETURN_URLS; `challenge` is base64url(SHA-256(verifier)) for a random verifier the client keeps.
   */
  oauthStartUrl(provider: OAuthProviderId, returnTo: string, challenge: string): string;
  /** Trades the one-time ticket from the return URL (with the client's verifier) for a session — like `login`. */
  oauthExchange(ticket: string, verifier: string, signal?: AbortSignal): Promise<LoginResponse>;
  /**
   * Authenticated call to any `/api/v1` endpoint, typed by the caller with the shared types.
   * Used by the admin backoffice; error responses throw `ApiClientError` with `status` and `code`.
   */
  request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    options?: RequestOptions,
  ): Promise<T>;
  /**
   * Authenticated GET of a file response (e.g. a CSV export) with the same token refresh and error handling
   * as `request`. Returns the text and the filename the API suggested.
   */
  download(
    path: string,
    options?: Pick<RequestOptions, 'query' | 'signal'>,
  ): Promise<DownloadedFile>;
}

export interface DownloadedFile {
  text: string;
  filename: string;
  contentType: string;
  /** True when the API stopped at its row limit (`x-export-truncated`). */
  truncated: boolean;
}

export class ApiClientError extends Error {
  readonly status: number | undefined;
  /** Machine-readable code from the API (e.g. `INVALID_CREDENTIALS`, `MFA_REQUIRED`). */
  readonly code: string | undefined;
  /** Field-level problems for validation / conflict errors, e.g. `[{ path: 'animalCode', message: '…' }]`. */
  readonly details: { path: string; message: string }[] | undefined;

  constructor(
    message: string,
    status?: number,
    options?: {
      cause?: unknown;
      code?: string;
      details?: { path: string; message: string }[] | undefined;
    },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ApiClientError';
    this.status = status;
    this.code = options?.code;
    this.details = options?.details;
  }
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = trimTrailingSlashes(options.baseUrl);
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function send<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    schema: ZodType<T> | null,
    init: {
      body?: unknown;
      auth?: boolean;
      signal?: AbortSignal | undefined;
      query?: Record<string, QueryValue>;
      headers?: Record<string, string> | undefined;
      /** Read the body as a file instead of JSON. */
      file?: boolean;
    } = {},
  ): Promise<T> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
    }
    const url = `${baseUrl}${API_PREFIX}${path}${search.size > 0 ? `?${search}` : ''}`;

    const attempt = async (): Promise<Response> => {
      const headers: Record<string, string> = {
        ...init.headers,
        Accept: init.file ? 'text/csv, application/json;q=0.5' : 'application/json',
      };
      // A Blob (e.g. a photo) is sent as raw bytes; everything else as JSON.
      const raw = typeof Blob !== 'undefined' && init.body instanceof Blob;
      if (init.body !== undefined)
        headers['Content-Type'] = raw
          ? (init.body as Blob).type || 'application/octet-stream'
          : 'application/json';
      if (init.auth) {
        const token = await options.getAccessToken?.();
        if (token) headers['Authorization'] = `Bearer ${token}`;
      }
      try {
        return await doFetch(url, {
          method,
          headers,
          ...(init.body !== undefined
            ? { body: raw ? (init.body as Blob) : JSON.stringify(init.body) }
            : {}),
          ...(init.signal ? { signal: init.signal } : {}),
        });
      } catch (cause) {
        if (init.signal?.aborted) throw cause;
        throw new ApiClientError('Unable to reach the FARM+ API', undefined, { cause });
      }
    };

    let response = await attempt();
    if (
      response.status === 401 &&
      init.auth &&
      options.onUnauthorized &&
      (await options.onUnauthorized())
    ) {
      response = await attempt();
    }
    if (!response.ok) {
      const parsed = apiErrorResponseSchema.safeParse(await response.json().catch(() => null));
      throw new ApiClientError(
        parsed.success ? parsed.data.error.message : `API responded with HTTP ${response.status}`,
        response.status,
        parsed.success ? { code: parsed.data.error.code, details: parsed.data.error.details } : {},
      );
    }
    if (response.status === 204) return undefined as T;
    if (init.file) {
      const disposition = response.headers.get('content-disposition') ?? '';
      const file: DownloadedFile = {
        // Decode the bytes ourselves: `response.text()` silently DROPS a leading UTF-8 byte-order mark, and the CSV exports
        // rely on it so that Excel opens Thai text correctly.
        text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(await response.arrayBuffer()),
        filename: /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? 'export.csv',
        contentType: response.headers.get('content-type') ?? 'text/csv',
        truncated: response.headers.get('x-export-truncated') === 'true',
      };
      return file as T;
    }
    const json: unknown = await response.json();
    if (!schema) return json as T;
    const parsed = schema.safeParse(json);
    if (!parsed.success)
      throw new ApiClientError('API returned an unexpected payload', response.status);
    return parsed.data;
  }

  return {
    getHealth: (signal) => send('GET', '/health', healthResponseSchema, { signal }),
    register: async (input, signal) =>
      (await send('POST', '/auth/register', registerResponseSchema, { body: input, signal })).user,
    login: (input, signal) =>
      send('POST', '/auth/login', loginResponseSchema, { body: input, signal }),
    verifyMfa: (mfaToken, code, signal) =>
      send('POST', '/auth/mfa/verify', authenticatedResponseSchema, {
        body: { mfaToken, code },
        signal,
      }),
    refresh: async (refreshToken, signal) =>
      (
        await send('POST', '/auth/refresh', refreshResponseSchema, {
          body: { refreshToken },
          signal,
        })
      ).tokens,
    logout: (signal) => send('POST', '/auth/logout', null, { auth: true, signal }),
    getMyAccess: (signal) =>
      send('GET', '/auth/me', myAccessResponseSchema, { auth: true, signal }),
    oauthProviders: async (signal) =>
      (
        (await send('GET', '/auth/oauth/providers', null, { signal })) as {
          providers: OAuthProviderId[];
        }
      ).providers,
    oauthStartUrl: (provider, returnTo, challenge) =>
      `${baseUrl}${API_PREFIX}/auth/oauth/${provider}/start?${new URLSearchParams({ returnTo, challenge })}`,
    oauthExchange: (ticket, verifier, signal) =>
      send('POST', '/auth/oauth/exchange', loginResponseSchema, {
        body: { ticket, verifier },
        signal,
      }),
    request: (method, path, opts = {}) => send(method, path, null, { auth: true, ...opts }),
    download: (path, opts = {}) =>
      send<DownloadedFile>('GET', path, null, { auth: true, file: true, ...opts }),
  };
}
