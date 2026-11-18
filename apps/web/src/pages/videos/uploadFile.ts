import type { VideoUploadTicket } from '@farmplus/shared-types';

export interface UploadHandle {
  promise: Promise<void>;
  abort: () => void;
}

export { resolveUploadUrl } from '@farmplus/shared-utils';

/** Why a direct upload failed (the screen shows it in the user's language); `status` is the HTTP status. */
export type UploadErrorCode = 'tooLarge' | 'failed' | 'network' | 'cancelled' | 'timeout';
export class UploadError extends Error {
  constructor(
    message: string,
    readonly uploadCode: UploadErrorCode,
    readonly httpStatus?: number,
  ) {
    super(message);
  }
}

/**
 * Send the file straight to the provider (it never passes through FARM+'s servers). XMLHttpRequest gives real upload
 * progress. No credentials/cookies are attached: the URL itself is the one-time capability.
 */
export function uploadToProvider(
  file: File,
  upload: VideoUploadTicket['upload'],
  url: string,
  onProgress: (fraction: number) => void,
  Xhr: typeof XMLHttpRequest = XMLHttpRequest,
): UploadHandle {
  const xhr = new Xhr();
  const promise = new Promise<void>((resolve, reject) => {
    xhr.open(upload.method, url);
    xhr.withCredentials = false;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(
            xhr.status === 413
              ? new UploadError('The file is too large.', 'tooLarge', xhr.status)
              : new UploadError(`Upload failed (${xhr.status}).`, 'failed', xhr.status),
          );
    xhr.onerror = () =>
      reject(
        new UploadError('The upload could not be completed. Check your connection.', 'network'),
      );
    xhr.onabort = () => reject(new UploadError('Upload cancelled.', 'cancelled'));
    xhr.ontimeout = () => reject(new UploadError('The upload timed out.', 'timeout'));
    if (upload.encoding === 'multipart') {
      const form = new FormData();
      form.append('file', file);
      xhr.send(form);
    } else {
      xhr.setRequestHeader('content-type', file.type);
      xhr.send(file);
    }
  });
  return { promise, abort: () => xhr.abort() };
}
