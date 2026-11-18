import {
  POST_LIMITS,
  type CursorPage,
  type PostVisibility,
  type ReactionResult,
} from '@farmplus/shared-types';
import { createPostSchema, fieldErrorsFromZod, type FieldErrors } from '@farmplus/validation';
import { getLocale, t } from '@/i18n';
import { validationText } from '@/lib/messages';

export interface MediaDraft {
  kind: 'image' | 'video';
  url: string;
  caption: string;
}
export interface PostDraft {
  body: string;
  visibility: PostVisibility;
  media: MediaDraft[];
}

/** Draft → API payload (trimmed, empty media rows dropped, empty captions omitted). */
export function toPostPayload(draft: PostDraft) {
  return {
    body: draft.body.trim(),
    visibility: draft.visibility,
    media: draft.media
      .filter((m) => m.url.trim())
      .map((m) => ({
        kind: m.kind,
        url: m.url.trim(),
        ...(m.caption.trim() ? { caption: m.caption.trim() } : {}),
      })),
  };
}

/** Same Zod schema as the API: client-side checks are a convenience, the server re-validates everything. */
export function validatePostDraft(draft: PostDraft): FieldErrors {
  const parsed = createPostSchema.safeParse(toPostPayload(draft));
  if (parsed.success) return {};
  const errors = fieldErrorsFromZod(parsed.error);
  return Object.fromEntries(
    Object.entries(errors).map(([path, message]) => [path, communityValidationText(message, path)]),
  );
}

/**
 * A community form's validation message (from the shared English schemas) in the current language. English is
 * returned unchanged; Thai uses the community catalog for the messages these forms know, else `validationText`.
 */
export function communityValidationText(english: string, path?: string): string {
  if (getLocale() === 'en') return english;
  if (english === 'Write something or attach a photo or video')
    return t('community', 'validation.postEmpty');
  if (english === 'Write a comment') return t('community', 'validation.commentEmpty');
  if (path === 'media')
    return t('community', 'validation.tooManyMedia', { max: POST_LIMITS.media });
  if (path && /^media\.\d+\.url$/.test(path)) return t('community', 'validation.httpsOnly');
  return validationText(english);
}

/** Append a cursor page; rows already present (a post that moved between pages) are skipped. */
export function mergeCursorPage<T extends { id: string }>(
  previous: T[],
  page: Pick<CursorPage<T>, 'items'>,
  replace: boolean,
): T[] {
  if (replace) return page.items;
  const seen = new Set(previous.map((i) => i.id));
  return [...previous, ...page.items.filter((i) => !seen.has(i.id))];
}

/** The state a like button shows right after the tap, before the server answers. */
export function optimisticReaction<
  T extends { reactionCount: number; viewer: { reacted: boolean } },
>(item: T): T {
  const was = item.viewer.reacted;
  return {
    ...item,
    reactionCount: Math.max(0, item.reactionCount + (was ? -1 : 1)),
    viewer: { ...item.viewer, reacted: !was },
  };
}

export const settleReaction = <T extends { reactionCount: number; viewer: { reacted: boolean } }>(
  item: T,
  result: ReactionResult,
): T => ({
  ...item,
  reactionCount: result.reactionCount,
  viewer: { ...item.viewer, reacted: result.reacted },
});

const VISIBILITY_VALUES: PostVisibility[] = ['public', 'followers', 'private'];

/** Visibility choices for a new post, labelled in the current language (call at render time). */
export function visibilityOptions(): { value: PostVisibility; label: string }[] {
  return VISIBILITY_VALUES.map((value) => ({
    value,
    label: t('community', `visibility.${value}`),
  }));
}
