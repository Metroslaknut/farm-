import { useState, type FormEvent } from 'react';
import type { RecordAttachment, RecordHistoryEntry } from '@farmplus/shared-types';
import {
  addMediaSchema,
  fieldErrorsFromDetails,
  fieldErrorsFromZod,
  type FieldErrors,
} from '@farmplus/validation';
import { api } from '../../../api';
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
import { enumLabel, localizeErrors, useFarmFormat, useFarmsT, type FarmsKey } from '../labels';

const show = (v: unknown): string =>
  v === null || v === undefined || v === ''
    ? '—'
    : typeof v === 'object'
      ? JSON.stringify(v)
      : String(v);
const KIND_LABEL: Record<RecordHistoryEntry['kind'], FarmsKey> = {
  correction: 'rec.list.corrected',
  attachment_added: 'rec.hist.attached',
  attachment_removed: 'rec.hist.removed',
  void: 'common.voided',
  event: 'rec.hist.recorded',
};

/** Every correction, void, attachment change and status event of a record: who, when, why, and old → new values. */
export function HistoryList({ history }: { history: RecordHistoryEntry[] }) {
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
                  <code>{c.field}</code>: <s>{show(c.from)}</s> → <strong>{show(c.to)}</strong>
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
}

export function RecordHistoryPanel({
  basePath,
  record,
  history,
  canWrite,
  canCorrect,
  onChanged,
}: Props) {
  const t = useFarmsT();
  const [form, setForm] = useState({ kind: 'document', url: '', caption: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<RecordAttachment | null>(null);
  const [reason, setReason] = useState('');
  const [removeError, setRemoveError] = useState<string>();
  const editable = !record.voided;

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
              <a href={a.url} target="_blank" rel="noopener noreferrer">
                {a.caption ?? a.url}
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
        <HistoryList history={history} />
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
