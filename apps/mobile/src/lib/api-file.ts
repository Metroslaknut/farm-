import { resolveUploadUrl } from '@farmplus/shared-utils';

/**
 * URL for a file the API serves itself. Photos uploaded from a device are stored as paths such as
 * `/api/v1/animal-photos/…`, which an <Image> cannot load without the API host; absolute URLs (CDN links) are returned
 * unchanged. The web app does the same with `apiFileUrl` in apps/web/src/api.ts.
 */
export const apiFileUrl = (url: string, apiBase: string | null): string =>
  url.startsWith('/') && apiBase ? resolveUploadUrl(url, apiBase, '') : url;
