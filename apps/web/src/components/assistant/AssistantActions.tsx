import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AssistantActResultDTO, FarmSummary, Page } from '@farmplus/shared-types';
import { api } from '../../api';
import { useLocale, useT } from '../../i18n';
import { formatDate } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { useTours } from '../../tours/TourProvider';
import { Alert, Button, Select, Textarea } from '../ui';

/** Fields the assistant can name (anything else it reports is not shown). */
const FIELDS = new Set([
  'animalId',
  'weightKg',
  'weighedOn',
  'feedName',
  'quantity',
  'quantity.amount',
  'groupLabel',
  'frequencyPerDay',
  'date',
  'endDate',
  'animalTypeId',
  'sex',
  'name',
  'animalCode',
  'birthDate',
]);
const DATES = new Set(['weighedOn', 'date', 'endDate', 'birthDate']);

/**
 * "Ask the assistant to do it" (docs/architecture/assistant-actions.md, PR 6a): opens a page, a tour or a form filled
 * in from what the person typed. It never saves: the person checks the form and presses its own Save.
 */
export default function AssistantActions() {
  const t = useT('help');
  const [locale] = useLocale();
  const navigate = useNavigate();
  const { start } = useTours();
  const farms = useAsync(
    (signal) =>
      api.request<Page<FarmSummary>>('GET', '/farms', {
        query: { status: 'active', pageSize: 50 },
        signal,
      }),
    [],
  );
  const [farmId, setFarmId] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [result, setResult] = useState<AssistantActResultDTO | null>(null);
  const list = farms.data?.items ?? [];
  const chosen = farmId || (list.length === 1 ? list[0]!.id : '');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (message.trim().length < 2 || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      setResult(
        await api.request<AssistantActResultDTO>('POST', '/assistant/act', {
          body: {
            message: message.trim(),
            locale,
            context: { route: '/help', ...(chosen ? { farmId: chosen } : {}) },
          },
        }),
      );
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const shown = (field: string, value: string) => {
    if (DATES.has(field)) return formatDate(value);
    if (field === 'sex') return t(`act.sex.${value === 'male' ? 'male' : 'female'}`);
    if (field === 'weightKg') return t('act.kg', { n: value });
    if (field === 'quantity') {
      const [amount, unit] = value.split(' ');
      return `${amount} ${t(`act.unit.${unit as 'kg'}`)}`;
    }
    return value;
  };

  return (
    <section aria-labelledby="help-actions" className="help-section" data-tour="help-actions">
      <h2 id="help-actions">{t('act.title')}</h2>
      <form onSubmit={submit} className="ds-stack">
        {list.length > 1 && (
          <Select label={t('act.farm')} value={chosen} onChange={(e) => setFarmId(e.target.value)}>
            <option value="">{t('act.noFarm')}</option>
            {list.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        )}
        <Textarea
          label={t('act.label')}
          hint={t('act.hint')}
          value={message}
          maxLength={500}
          rows={2}
          placeholder={t('act.placeholder')}
          onChange={(e) => setMessage(e.target.value)}
        />
        <div>
          <Button type="submit" variant="primary" disabled={busy || message.trim().length < 2}>
            {busy ? t('assistant.asking') : t('act.submit')}
          </Button>
        </div>
      </form>
      <div aria-live="polite" data-testid="assistant-act-result">
        {failed && <Alert tone="danger">{t('assistant.error')}</Alert>}
        {result && !failed && result.kind === 'form' && (
          <div className="ds-stack">
            <p>
              <strong>{t(`act.form.${result.form}`)}</strong>
            </p>
            <ul>
              {result.understood
                .filter((u) => FIELDS.has(u.field))
                .map((u) => (
                  <li key={u.field}>
                    {t(`act.field.${u.field as 'animalId'}`)}: {shown(u.field, u.value)}
                  </li>
                ))}
            </ul>
            <p className="ds-field__hint">{t('act.check')}</p>
            <div>
              <Button
                variant="primary"
                onClick={() =>
                  navigate(result.route, { state: { assistantPrefill: result.values } })
                }
              >
                {t('act.openForm')}
              </Button>
            </div>
          </div>
        )}
        {result && !failed && result.kind === 'navigate' && (
          <Button variant="primary" onClick={() => navigate(result.route)}>
            {t('act.goTo', { page: result.label })}
          </Button>
        )}
        {result && !failed && result.kind === 'tour' && (
          <Button variant="primary" onClick={() => start(result.tourId)}>
            {t('act.startTour')}
          </Button>
        )}
        {result && !failed && result.kind === 'question' && (
          <Alert tone="info">
            {result.missing.some((m) => FIELDS.has(m))
              ? t('act.missing', {
                  fields: result.missing
                    .filter((m) => FIELDS.has(m))
                    .map((m) => t(`act.field.${m as 'animalId'}`))
                    .join(', '),
                })
              : t('act.moreInfo')}
          </Alert>
        )}
        {result && !failed && result.kind === 'none' && (
          <Alert tone="info">{t(`act.none.${result.reason}`)}</Alert>
        )}
      </div>
    </section>
  );
}
