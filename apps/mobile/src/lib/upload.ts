import type { VideoUploadTicket } from '@farmplus/shared-types';
import { resolveUploadUrl } from '@farmplus/shared-utils';
import { appConfig } from '@/config/env';
import { t } from '@/i18n';
import { AppError } from '@/lib/messages';
import type { PickedVideo } from './pickedVideo';

export { toPickedVideo, type PickedVideo } from './pickedVideo';

export interface UploadHandle {
  promise: Promise<void>;
  abort: () => void;
}

/** Read a local file as a Blob (XMLHttpRequest works for file:// URIs on iOS and Android). */
function readLocalBlob(uri: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const req = new XMLHttpRequest();
    req.responseType = 'blob';
    req.onload = () => resolve(req.response as Blob);
    req.onerror = () => reject(new Error('read failed'));
    req.open('GET', uri);
    req.send();
  });
}

/**
 * Send the file straight to the video provider using the one-time URL from the API (the file never passes through
 * FARM+'s servers). XMLHttpRequest gives real upload progress on iOS/Android.
 */
export function uploadVideo(
  file: PickedVideo,
  upload: VideoUploadTicket['upload'],
  onProgress: (fraction: number) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest();
  const url = resolveUploadUrl(upload.url, appConfig.apiBaseUrl ?? '', 'http://localhost');
  const promise = new Promise<void>((resolve, reject) => {
    xhr.open(upload.method, url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(
            new AppError(
              xhr.status === 413
                ? t('videos', 'upload.tooLarge')
                : t('videos', 'upload.failedStatus', { status: xhr.status }),
            ),
          );
    xhr.onerror = () => reject(new AppError(t('videos', 'upload.network')));
    xhr.onabort = () => reject(new AppError(t('videos', 'upload.cancelled')));
    if (upload.encoding === 'multipart') {
      const form = new FormData();
      // React Native's FormData reads the file from its local URI.
      form.append('file', {
        uri: file.uri,
        name: file.name,
        type: file.mimeType,
      } as unknown as Blob);
      xhr.send(form);
    } else {
      xhr.setRequestHeader('content-type', file.mimeType);
      readLocalBlob(file.uri)
        .then((blob) => xhr.send(blob))
        .catch(() => reject(new AppError(t('videos', 'upload.readFailed'))));
    }
  });
  return { promise, abort: () => xhr.abort() };
}
