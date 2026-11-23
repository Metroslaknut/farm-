import { useState, type FormEvent } from 'react';
import type { RecordAttachment, RecordHistoryEntry } from '@farmplus/shared-types';
import {
  addMediaSchema,
  fieldErrorsFromDetails,
  fieldErrorsFromZod,
  type FieldErrors,
} from '@farmplus/validation';
import { api, apiFileUrl } from '../../../api';
import {
  Alert,
  Badge,
  Button,
  Card,
  Modal,
  Select,
  TextField,
  Textarea,
} from '../../../components/ui';
import { errorMessage } from '../../../lib/format';
import { formatNumber } from '@farmplus/i18n';
import { getLocale } from '../../../i18n';
import {
  bahtLabel,
  enumLabel,
  localizeErrors,
  useFarmFormat,
  useFarmsT,
  type FarmsKey,
  type FarmsT,
} from '../labels';
import type { Field, KindConfig } from './recordConfigs';
import { PhotoPicker, type PendingPhoto } from '../PhotoPicker';

/** Same cap as the API (a record holds at most 20 files). */
const MAX_FILES = 20;

const show = (v: unknown): string =>
  v === null || v === undefined || v === ''
    ? '—'
    : typeof v === 'object'
      ? JSON.stringify(v)
      : String(v);

type FieldLookup = Pick<KindConfig, 'fields'>;

/** The form field a stored path belongs to (the first, when a field is declared twice for different steps). */
const fieldOf = (config: FieldLookup | undefined, path: string): Field | undefined =>
  config?.fields.find((f) => f.name === path);

/** A changed field's name as on the form ("Amount (THB)"), or the raw name when the form does not know it. */
export function changeLabel(t: FarmsT, config: FieldLookup | undefined, field: string): string {
  const own = fieldOf(config, field);
  if (own) return t(own.label);
  if (field === 'voided') return t('common.voided');
  if (field === 'attachments') return t('common.file');
  return field;
}

/** A changed value, formatted the way the form field shows it: options, dates, money, numbers, nested groups. */
export function changeValue(
  t: FarmsT,
  fmt: { date: (v: string | undefined | null) => string },
  config: FieldLookup | undefined,
  path: string,
  v: unknown,
): string {
  if (v === null || v === undefined || v === '') return '—';
  const field = fieldOf(config, path);
  if (typeof v === 'boolean') return v ? t('common.yes') : t('common.no');
  if (Array.isArray(v)) return v.map((x) => changeValue(t, fmt, config, path, x)).join(', ');
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (path === 'attachments' && typeof obj['kind'] === 'string')
      return `${enumLabel(t, 'mediaKindRaw', obj['kind'])} ${show(obj['url'])}`;
    // A nested group (`quantity`, `medication`, …): each part with its own form label.
    if (config?.fields.some((f) => f.name.startsWith(`${path}.`)))
      return Object.entries(obj)
        .filter(([, x]) => x !== null && x !== undefined && x !== '')
        .map(([k, x]) => {
          const sub = `${path}.${k}`;
          return `${changeLabel(t, config, sub)}: ${changeValue(t, fmt, config, sub, x)}`;
        })
        .join(', ');
    return JSON.stringify(v);
  }
  if (field?.options) {
    const option = field.options.find((o) => o.value === String(v));
    if (option) return t(option.label);
  }
  if (typeof v === 'number') {
    if (field?.money) return bahtLabel(v);
    return formatNumber(v, getLocale());
  }
  if (field?.type === 'date' && typeof v === 'string') return fmt.date(v);
  return String(v);
}

const KIND_LABEL: Record<RecordHistoryEntry['kind'], FarmsKey> = {
  correction: 'rec.list.corrected',
  attachment_added: 'rec.hist.attached',
  attachment_removed: 'rec.hist.removed',
  void: 'common.voided',
  event: 'rec.hist.recorded',
};

/** Every correction, void, attachment change and status event of a record: who, when, why, and old → new values. */
export function HistoryList({
  history,
  config,
}: {
  history: RecordHistoryEntry[];
  /** The record kind's form config: changed fields are named and formatted like on the form. */
  config?: FieldLookup;
}) {
  const t = useFarmsT();
  const fmt = useFarmFormat();
  if (history.length === 0) return <p className="ds-field__hint">{t('rec.hist.none')}</p>;
  return (
    <ol style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--ds-space-4)' }}>
      {history.map((h, i) => (
        <li key={i}>
          <strong>{t(KIND_LABEL[h.kind])}</strong>{' '}
          <span className="ds-field__hint">
            {t('rec.hist.by', { name: h.by.displayName, date: fmt.dateTime(h.at) })}
          </span>
          {h.reason && <p style={{ margin: 0, fontStyle: 'italic' }}>“{h.reason}”</p>}
          {h.changes.length > 0 && (
            <ul style={{ margin: 'var(--ds-space-1) 0 0', paddingLeft: '1.2rem' }}>
              {h.changes.map((c, j) => (
                <li key={j}>
                  {changeLabel(t, config, c.field)}:{' '}
                  <s>{changeValue(t, fmt, config, c.field, c.from)}</s> →{' '}
                  <strong>{changeValue(t, fmt, config, c.field, c.to)}</strong>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

interface Props {
  basePath: string;
  record: { id: string; attachments: RecordAttachment[]; voided?: unknown; revision: number };
  history: RecordHistoryEntry[];
  canWrite: boolean;
  canCorrect: boolean;
  onChanged: () => void;
  /** Offer uploading photos from the device (`POST <basePath>/:id/photos`), e.g. for breeding records. */
  allowUpload?: boolean;
  /** The record kind's form config, to name and format the fields in the history. */
  config?: FieldLookup;
}

export function RecordHistoryPanel({
  basePath,
  record,
  history,
  canWrite,
  canCorrect,
  onChanged,
  allowUpload = false,
  config,
}: Props) {
  const t = useFarmsT();
  const [form, setForm] = useState({ kind: 'document', url: '', caption: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<RecordAttachment | null>(null);
  const [reason, setReason] = useState('');
  const [removeError, setRemoveError] = useState<string>();
  const editable = !record.voided;
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [uploading, setUploading] = useState<number>();
  const [uploadError, setUploadError] = useState<string>();

  /** One request per photo (the body is the image); stops at the first failure and keeps the rest to retry. */
  const upload = async () => {
    setUploadError(undefined);
    let left = pending;
    try {
      for (const [i, p] of pending.entries()) {
        setUploading(i + 1);
        await api.request('POST', `${basePath}/${record.id}/photos`, { body: p.blob });
        left = pending.slice(i + 1);
      }
    } catch (e) {
      setUploadError(t('rec.hist.uploadFailed', { error: errorMessage(e) }));
    } finally {
      setPending(left);
      setUploading(undefined);
      onChanged();
    }
  };

  const attach = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = addMediaSchema.safeParse({
      kind: form.kind,
      url: form.url.trim(),
      ...(form.caption.trim() ? { caption: form.caption.trim() } : {}),
    });
    if (!parsed.success) return setErrors(localizeErrors(fieldErrorsFromZod(parsed.error)));
    setBusy(true);
    setErrors({});
    try {
      await api.request('POST', `${basePath}/${record.id}/attachments`, { body: parsed.data });
      setForm({ ...form, url: '', caption: '' });
      onChanged();
    } catch (e) {
      const api2 = fieldErrorsFromDetails(
        (e as { details?: { path: string; message: string }[] }).details,
      );
      setErrors(Object.keys(api2).length ? localizeErrors(api2) : { _form: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    setRemoveError(undefined);
    try {
      await api.request('POST', `${basePath}/${record.id}/attachments/${removing.id}/remove`, {
        body: { reason: reason.trim() },
      });
      setRemoving(null);
      setReason('');
      onChanged();
    } catch (e) {
      setRemoveError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card
        title={t('common.photosDocs', { count: record.attachments.length })}
        headingLevel={2}
        style={{ marginBottom: 'var(--ds-space-4)' }}
      >
        {record.attachments.length === 0 && <p>{t('common.noFiles')}</p>}
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--ds-space-2)' }}>
          {record.attachments.map((a) => (
            <li key={a.id} className="ds-row">
              <Badge>{enumLabel(t, 'mediaKindRaw', a.kind)}</Badge>
              <a href={apiFileUrl(a.url)} target="_blank" rel="noopener noreferrer">
                {a.kind === 'photo' ? (
                  <img
                    src={apiFileUrl(a.url)}
                    alt={a.caption ?? t('common.photo')}
                    style={{
                      width: 72,
                      height: 72,
                      objectFit: 'cover',
                      borderRadius: 'var(--ds-radius-md)',
                    }}
                  />
                ) : (
                  (a.caption ?? a.url)
                )}
              </a>
              <span className="ds-field__hint">
                {t('rec.hist.addedBy', { name: a.addedBy.displayName })}
              </span>
              {canCorrect && editable && (
                <Button
                  size="sm"
                  aria-label={t('common.removeFile', { name: a.caption ?? t('common.file') })}
                  onClick={() => {
                    setRemoving(a);
                    setRemoveError(undefined);
                  }}
                >
                  {t('common.remove')}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {allowUpload && canWrite && editable && record.attachments.length < MAX_FILES && (
          <div style={{ marginBottom: 'var(--ds-space-4)' }}>
            <h3>{t('rec.hist.uploadTitle')}</h3>
            <PhotoPicker
              photos={pending}
              onChange={setPending}
              max={MAX_FILES - record.attachments.length}
              disabled={uploading !== undefined}
            />
            {uploading !== undefined && (
              <p role="status" className="ds-field__hint">
                {t('photos.uploading', { n: uploading, total: pending.length })}
              </p>
            )}
            {uploadError && <Alert tone="danger">{uploadError}</Alert>}
            <Button
              variant="primary"
              disabled={pending.length === 0}
              loading={uploading !== undefined}
              onClick={() => void upload()}
            >
              {t('rec.hist.uploadPhotos', { n: pending.length })}
            </Button>
          </div>
        )}
        {canWrite && editable && (
          <form onSubmit={attach} noValidate>
            <h3>{t('common.attachTitle')}</h3>
            <div className="ds-grid ds-grid--3">
              <Select
                label={t('common.kind')}
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value })}
              >
                <option value="document">{t('common.document')}</option>
                <option value="photo">{t('common.photo')}</option>
              </Select>
              <TextField
                label={t('rec.hist.fileLink')}
                type="url"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                error={errors['url'] ?? errors['_form']}
              />
              <TextField
                label={t('common.caption')}
                value={form.caption}
                onChange={(e) => setForm({ ...form, caption: e.target.value })}
                error={errors['caption']}
              />
            </div>
            <Button type="submit" loading={busy}>
              {t('common.attach')}
            </Button>
          </form>
        )}
      </Card>

      <Card title={t('rec.hist.title')} headingLevel={2}>
        <p className="ds-field__hint">{t('rec.hist.hint', { revision: record.revision })}</p>
        <HistoryList history={history} config={config} />
      </Card>

      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t('rec.hist.removeTitle')}
        footer={
          <>
            <Button onClick={() => setRemoving(null)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={reason.trim().length < 3}
              onClick={() => void remove()}
            >
              {t('common.remove')}
            </Button>
          </>
        }
      >
        <p>{t('rec.hist.removeHint')}</p>
        <Textarea
          label={t('common.reason')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
        />
        {removeError && <Alert tone="danger">{removeError}</Alert>}
      </Modal>
    </>
  );
}
