import { useState, type FormEvent } from 'react';
import { useAdminI18n } from './i18n';

export type FilterField =
  | { name: string; label: string; type: 'search'; placeholder?: string }
  | { name: string; label: string; type: 'select'; options: { value: string; label: string }[] }
  | { name: string; label: string; type: 'date' };

interface Props {
  fields: FilterField[];
  values: Record<string, string>;
  onChange: (patch: Record<string, string>) => void;
  onReset?: () => void;
}

/** Search boxes apply on submit; selects apply immediately. */
export function SearchFilters({ fields, values, onChange, onReset }: Props) {
  const { t } = useAdminI18n();
  const [draft, setDraft] = useState<Record<string, string>>(values);
  // Re-sync typed text when the applied values change (reset, URL navigation) — adjusted during render.
  const [seen, setSeen] = useState(values);
  if (seen !== values) {
    setSeen(values);
    setDraft(values);
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const patch: Record<string, string> = {};
    for (const f of fields) if (f.type === 'search') patch[f.name] = (draft[f.name] ?? '').trim();
    onChange(patch);
  };

  return (
    <form className="adm-filters" role="search" onSubmit={submit}>
      {fields.map((f) => (
        <label key={f.name} className="adm-field">
          <span>{f.label}</span>
          {f.type === 'date' ? (
            <input
              type="date"
              value={values[f.name] ?? ''}
              onChange={(e) => onChange({ [f.name]: e.target.value })}
            />
          ) : f.type === 'search' ? (
            <input
              type="search"
              value={draft[f.name] ?? ''}
              placeholder={f.placeholder}
              onChange={(e) => setDraft({ ...draft, [f.name]: e.target.value })}
            />
          ) : (
            <select
              value={values[f.name] ?? ''}
              onChange={(e) => onChange({ [f.name]: e.target.value })}
            >
              <option value="">{t('common.all')}</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </label>
      ))}
      <div className="adm-filters__actions">
        <button type="submit" className="adm-btn adm-btn--primary">
          {t('common.search')}
        </button>
        {onReset && (
          <button type="button" className="adm-btn" onClick={onReset}>
            {t('common.reset')}
          </button>
        )}
      </div>
    </form>
  );
}
