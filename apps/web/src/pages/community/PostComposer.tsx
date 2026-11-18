import { useState, type FormEvent } from 'react';
import {
  POST_LIMITS,
  POST_MEDIA_KINDS,
  POST_VISIBILITIES,
  type PostVisibility,
} from '@farmplus/shared-types';
import {
  createPostSchema,
  fieldErrorsFromDetails,
  fieldErrorsFromZod,
  type FieldErrors,
} from '@farmplus/validation';
import { Alert, Button, Select, TextField, Textarea } from '../../components/ui';
import { useT } from '../../i18n';
import { errorMessage } from '../../lib/format';
import { localizeFieldErrors } from './localize';

interface MediaRow {
  kind: 'image' | 'video';
  url: string;
  caption: string;
}
export interface ComposerValue {
  body: string;
  media: { kind: 'image' | 'video'; url: string; caption?: string }[];
  visibility: PostVisibility;
}

const VISIBILITY_HINT = {
  public: 'visibilityHint.public',
  followers: 'visibilityHint.followers',
  private: 'visibilityHint.private',
} as const satisfies Record<PostVisibility, string>;
const VISIBILITY_LABEL = {
  public: 'visibility.public',
  followers: 'visibility.followers',
  private: 'visibility.private',
} as const satisfies Record<PostVisibility, string>;
const MEDIA_KIND_LABEL = { image: 'mediaKind.image', video: 'mediaKind.video' } as const;

/** Create-post / edit-post form. Validated with the same Zod schema the API uses; the API re-checks everything. */
export function PostComposer({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: {
    body: string;
    media: { kind: 'image' | 'video'; url: string; caption?: string | null }[];
    visibility: PostVisibility;
  };
  submitLabel: string;
  onSubmit: (value: ComposerValue) => Promise<void>;
  onCancel?: () => void;
}) {
  const t = useT('community');
  const [body, setBody] = useState(initial?.body ?? '');
  const [visibility, setVisibility] = useState<PostVisibility>(initial?.visibility ?? 'public');
  const [rows, setRows] = useState<MediaRow[]>(
    (initial?.media ?? []).map((m) => ({ kind: m.kind, url: m.url, caption: m.caption ?? '' })),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  const update = (i: number, patch: Partial<MediaRow>) =>
    setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = {
      body: body.trim(),
      visibility,
      media: rows
        .filter((r) => r.url.trim())
        .map((r) => ({
          kind: r.kind,
          url: r.url.trim(),
          ...(r.caption.trim() ? { caption: r.caption.trim() } : {}),
        })),
    };
    const parsed = createPostSchema.safeParse(value);
    if (!parsed.success) return setErrors(localizeFieldErrors(fieldErrorsFromZod(parsed.error)));
    setBusy(true);
    setErrors({});
    try {
      await onSubmit(value);
      if (!initial) {
        setBody('');
        setRows([]);
      }
    } catch (e) {
      const mapped = fieldErrorsFromDetails(
        (e as { details?: { path: string; message: string }[] }).details,
      );
      setErrors(
        Object.keys(mapped).length ? localizeFieldErrors(mapped) : { _form: errorMessage(e) },
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label={initial ? t('composer.editAria') : t('composer.createAria')}
    >
      {errors['_form'] && <Alert tone="danger">{errors['_form']}</Alert>}
      <Textarea
        label={initial ? t('composer.labelEdit') : t('composer.label')}
        rows={3}
        value={body}
        maxLength={POST_LIMITS.body}
        placeholder={t('composer.placeholder')}
        onChange={(e) => setBody(e.target.value)}
        error={errors['body']}
        hint={`${body.length}/${POST_LIMITS.body}`}
      />
      {rows.map((r, i) => (
        <div key={i} className="ds-grid ds-grid--3" style={{ alignItems: 'end' }}>
          <Select
            label={t('composer.media', { n: i + 1 })}
            value={r.kind}
            onChange={(e) => update(i, { kind: e.target.value as MediaRow['kind'] })}
          >
            {POST_MEDIA_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(MEDIA_KIND_LABEL[k])}
              </option>
            ))}
          </Select>
          <TextField
            label={t('composer.fileLink')}
            type="url"
            value={r.url}
            onChange={(e) => update(i, { url: e.target.value })}
            error={errors[`media.${i}.url`]}
          />
          <TextField
            label={t('composer.caption')}
            value={r.caption}
            maxLength={POST_LIMITS.caption}
            onChange={(e) => update(i, { caption: e.target.value })}
            error={errors[`media.${i}.caption`] ?? errors[`media.${i}.mimeType`]}
          />
          <Button
            size="sm"
            aria-label={t('composer.removeMedia', { n: i + 1 })}
            onClick={() => setRows((all) => all.filter((_, j) => j !== i))}
          >
            {t('common.remove')}
          </Button>
        </div>
      ))}
      {errors['media'] && <Alert tone="danger">{errors['media']}</Alert>}
      <div className="ds-row" style={{ marginTop: 'var(--ds-space-3)' }}>
        <Button
          disabled={rows.length >= POST_LIMITS.media}
          onClick={() => setRows((all) => [...all, { kind: 'image', url: '', caption: '' }])}
        >
          {t('composer.addMedia')}
        </Button>
        <Select
          label={t('composer.visibility')}
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as PostVisibility)}
          hint={t(VISIBILITY_HINT[visibility])}
        >
          {POST_VISIBILITIES.map((v) => (
            <option key={v} value={v}>
              {t(VISIBILITY_LABEL[v])}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="primary" loading={busy}>
          {submitLabel}
        </Button>
        {onCancel && <Button onClick={onCancel}>{t('common.cancel')}</Button>}
      </div>
      <p className="ds-field__hint">{t('composer.storageNote')}</p>
    </form>
  );
}
