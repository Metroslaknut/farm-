import { useState, type FormEvent, type ReactNode } from 'react';
import { GRANULARITIES } from '@farmplus/shared-types';
import { api } from '../../api';
import { useT } from '../../i18n';
import { errorMessage } from '../../lib/format';
import { saveTextFile } from './format';
import './analytics.css';

/** Date range + granularity + any extra filters. Applies on submit, so typing never refetches. */
export function FilterForm({
  params,
  onApply,
  resetKey = '',
  children,
}: {
  params: URLSearchParams;
  /** Change to remount the inputs (e.g. when a select's options finish loading). */
  resetKey?: string;
  onApply: (next: URLSearchParams) => void;
  children?: ReactNode;
}) {
  const t = useT('layout');
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const next = new URLSearchParams();
    for (const [k, v] of form.entries()) if (typeof v === 'string' && v !== '') next.set(k, v);
    onApply(next);
  };
  // Remount when the applied filters change so the inputs always show what is applied.
  return (
    <form
      className="an-filters"
      onSubmit={submit}
      key={`${params.toString()}|${resetKey}`}
      aria-label={t('analytics.filters')}
    >
      <label>
        {t('analytics.from')}
        <input type="date" name="from" defaultValue={params.get('from') ?? ''} />
      </label>
      <label>
        {t('analytics.to')}
        <input type="date" name="to" defaultValue={params.get('to') ?? ''} />
      </label>
      <label>
        {t('analytics.groupBy')}
        <select name="granularity" defaultValue={params.get('granularity') ?? ''}>
          <option value="">{t('analytics.automatic')}</option>
          {GRANULARITIES.map((g) => (
            <option key={g} value={g}>
              {t(`analytics.granularity.${g}`)}
            </option>
          ))}
        </select>
      </label>
      {children}
      <button type="submit">{t('analytics.apply')}</button>
      <button type="button" onClick={() => onApply(new URLSearchParams())}>
        {t('analytics.last30')}
      </button>
    </form>
  );
}

/** One button per CSV the viewer may export. The API re-checks the same permission on every download. */
export function ExportButtons({
  path,
  params,
  sections,
}: {
  path: string;
  params: URLSearchParams;
  sections: { section: string; label: string }[];
}) {
  const t = useT('layout');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  if (sections.length === 0) return null;
  const run = async (section: string) => {
    setBusy(section);
    setMessage(null);
    try {
      const query: Record<string, string> = { section };
      for (const k of ['from', 'to', 'animalType', 'orderKind', 'granularity'])
        if (params.get(k)) query[k] = params.get(k)!;
      const file = await api.download(path, { query });
      saveTextFile(file.text, file.filename, file.contentType);
      setMessage({
        error: false,
        text: file.truncated
          ? t('analytics.savedTruncated', { file: file.filename })
          : t('analytics.saved', { file: file.filename }),
      });
    } catch (e) {
      setMessage({ error: true, text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="an-exports">
      <span>{t('analytics.downloadCsv')}</span>
      {sections.map((s) => (
        <button
          key={s.section}
          type="button"
          disabled={busy !== null}
          onClick={() => void run(s.section)}
        >
          {busy === s.section ? t('analytics.preparing') : s.label}
        </button>
      ))}
      {message && (
        <span role={message.error ? 'alert' : 'status'} className="an-muted">
          {message.text}
        </span>
      )}
    </div>
  );
}
