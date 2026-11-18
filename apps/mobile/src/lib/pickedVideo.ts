import { humanize, validateVideoFile } from '@farmplus/shared-utils';
import { getLocale, t } from '@/i18n';
import { validationText } from '@/lib/messages';

/** What the image picker returns for a video, normalised for upload (pure, so it is unit-testable). */
export interface PickedVideo {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

/** Normalise an image-picker asset to what the upload needs (some platforms omit name/mime/size). */
export function toPickedVideo(asset: {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
}): PickedVideo {
  const name = asset.fileName ?? asset.uri.split('/').pop() ?? 'video.mp4';
  const ext = name.split('.').pop()?.toLowerCase();
  const guessed = ext === 'mov' ? 'video/quicktime' : ext === 'webm' ? 'video/webm' : 'video/mp4';
  return { uri: asset.uri, name, mimeType: asset.mimeType ?? guessed, size: asset.fileSize ?? 0 };
}

type UploadRules = Parameters<typeof validateVideoFile>[1];

/**
 * The shared (English) file check, in the current language. English is returned exactly as `validateVideoFile` gives
 * it; Thai is chosen by which rule failed.
 */
export function videoFileError(
  file: { name: string; type: string; size: number },
  rules: UploadRules,
): string | undefined {
  const english = validateVideoFile(file, rules);
  if (english === undefined || getLocale() === 'en') return english;
  if (!rules.mimeTypes.includes(file.type)) return t('videos', 'fileError.type');
  if (file.size <= 0) return t('videos', 'fileError.empty');
  if (file.size > rules.maxUploadBytes)
    return t('videos', 'fileError.tooLarge', {
      mb: Math.floor(rules.maxUploadBytes / 1024 / 1024),
    });
  return validationText(english);
}

const PROCESSING_STATES = ['pending_upload', 'processing', 'ready', 'failed'] as const;
const isProcessingState = (s: string): s is (typeof PROCESSING_STATES)[number] =>
  (PROCESSING_STATES as readonly string[]).includes(s);

/** Badge label for a processing state ("Pending upload"); unknown values fall back to `humanize`. */
export function processingStateLabel(state: string): string {
  return isProcessingState(state) ? t('videos', `state.${state}`) : humanize(state);
}

/** The state inside a sentence ("pending upload"). */
export function processingStateInline(state: string): string {
  return isProcessingState(state) ? t('videos', `stateInline.${state}`) : state.replace('_', ' ');
}

const FAILURE_CODES = [
  'upload_expired',
  'upload_cancelled',
  'processing_failed',
  'too_long',
  'unsupported_format',
  'provider_error',
] as const;

/**
 * Why processing failed: the server's (English) message in English; in Thai a message by failure code (a generic one
 * for an unknown code). Without a code the server's text is all there is, so it is kept.
 */
export function videoFailureText(failure: { code?: string | null; message: string }): string {
  if (getLocale() === 'en' || !failure.code) return failure.message;
  const code = FAILURE_CODES.find((c) => c === failure.code);
  return code ? t('videos', `failure.${code}`) : t('videos', 'failure.generic');
}
