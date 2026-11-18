import { t } from '@/i18n';
import { errorText } from '@/lib/messages';

export type ViewErrorKind = 'offline' | 'unauthorized' | 'server' | 'unknown';

export interface ViewError {
  kind: ViewErrorKind;
  message: string;
}

/**
 * Map any thrown value to something a screen can show. `status === undefined` on an ApiClientError means the
 * request never got a response (no connection, DNS, timeout, server down) — presented as "offline".
 * Other API errors show the server message in English and a message chosen by the error code in Thai.
 */
export function toViewError(error: unknown): ViewError {
  const e = error as { name?: string; status?: number; message?: string } | null;
  if (e?.name === 'ApiClientError') {
    if (e.status === undefined) return { kind: 'offline', message: t('errors', 'offline') };
    if (e.status === 401) return { kind: 'unauthorized', message: t('errors', 'sessionExpired') };
    if (e.status >= 500) return { kind: 'server', message: t('errors', 'server') };
    return {
      kind: 'unknown',
      message: e.message ? errorText(error) : t('errors', 'somethingWrongShort'),
    };
  }
  return { kind: 'unknown', message: t('errors', 'somethingWrong') };
}
