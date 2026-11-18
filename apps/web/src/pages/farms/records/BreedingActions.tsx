/* eslint-disable @typescript-eslint/no-explicit-any -- generic record engine: shape is driven by the per-kind config/schema */
import { useState } from 'react';
import type { AnimalSummary, BreedingRecordDTO, Page } from '@farmplus/shared-types';
import { ANIMAL_SEXES } from '@farmplus/shared-types';
import {
  confirmPregnancySchema,
  failBreedingSchema,
  fieldErrorsFromDetails,
  fieldErrorsFromZod,
  recordDeliverySchema,
  thaiToday,
  type FieldErrors,
} from '@farmplus/validation';
import { api } from '../../../api';
import { Alert, Button, Card, Select, TextField, Textarea } from '../../../components/ui';
import { errorMessage } from '../../../lib/format';
import { useAsync } from '../../../lib/useAsync';
import { enumLabel, localizeErrors, useFarmsT } from '../labels';

type Row = {
  mode: 'register' | 'link' | 'stillborn' | 'died_at_birth';
  code: string;
  name: string;
  sex: string;
  animalId: string;
};
const today = () => thaiToday();

/** Status events of a breeding: confirm pregnancy, record failure, record the delivery with its offspring. */
export function BreedingActions({
  farmId,
  record,
  canWrite,
  onChanged,
}: {
  farmId: string;
  record: BreedingRecordDTO;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const t = useFarmsT();
  const [date, setDate] = useState(today());
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const base = `/farms/${farmId}/breeding/${record.id}`;
  const animals = useAsync(
    (signal) =>
      api.request<Page<AnimalSummary>>('GET', `/farms/${farmId}/animals`, {
        query: { pageSize: 100, archived: 'false', sortBy: 'animalCode', order: 'asc' },
        signal,
      }),
    [farmId],
  );

  if (!canWrite || record.voided || record.status === 'failed') return null;

  const send = async (path: string, body: object, schema?: { safeParse(v: unknown): any }) => {
    if (schema) {
      const parsed = schema.safeParse(body);
      if (!parsed.success) return setErrors(localizeErrors(fieldErrorsFromZod(parsed.error)));
    }
    setBusy(true);
    setErrors({});
    try {
      await api.request('POST', `${base}/${path}`, { body });
      setText('');
      setRows([]);
      onChanged();
    } catch (e) {
      const mapped = fieldErrorsFromDetails(
        (e as { details?: { path: string; message: string }[] }).details,
      );
      setErrors(Object.keys(mapped).length ? localizeErrors(mapped) : { _form: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const offspring = () =>
    rows.map((r) =>
      r.mode === 'link'
        ? { animalId: r.animalId }
        : r.mode === 'register'
          ? {
              register: {
                sex: r.sex,
                ...(r.code.trim() ? { animalCode: r.code.trim() } : {}),
                ...(r.name.trim() ? { name: r.name.trim() } : {}),
              },
            }
          : { outcome: r.mode, ...(r.sex ? { sex: r.sex } : {}) },
    );
  const update = (i: number, patch: Partial<Row>) =>
    setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const candidates = (animals.data?.items ?? []).filter(
    (a) => a.animalType.id === record.dam.id || true,
  );
  const delivering = record.status === 'bred' || record.status === 'pregnant';

  return (
    <Card
      title={delivering ? t('breed.whatHappened') : t('breed.addOffspring')}
      headingLevel={2}
      style={{ marginBottom: 'var(--ds-space-4)' }}
    >
      {errors['_form'] && <Alert tone="danger">{errors['_form']}</Alert>}
      <TextField
        label={t('rec.date')}
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        error={errors['date']}
      />

      {record.status === 'bred' && (
        <div className="ds-row">
          <Button
            loading={busy}
            onClick={() => void send('pregnancy', { date }, confirmPregnancySchema)}
          >
            {t('breed.confirmPregnancy')}
          </Button>
        </div>
      )}

      {delivering && (
        <>
          <Textarea
            label={t('breed.failReason')}
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            error={errors['reason']}
          />
          <Button
            variant="danger"
            loading={busy}
            onClick={() => void send('failure', { date, reason: text.trim() }, failBreedingSchema)}
          >
            {t('breed.markFailed')}
          </Button>
          <hr />
        </>
      )}

      <h3>{delivering ? t('breed.delivery') : t('breed.moreOffspring')}</h3>
      <p className="ds-field__hint">{t('breed.hint')}</p>
      {rows.map((r, i) => (
        <div key={i} className="ds-grid ds-grid--3" style={{ alignItems: 'end' }}>
          <Select
            label={t('breed.offspringN', { n: i + 1 })}
            value={r.mode}
            onChange={(e) => update(i, { mode: e.target.value as Row['mode'] })}
          >
            <option value="register">{t('breed.mode.register')}</option>
            <option value="link">{t('breed.mode.link')}</option>
            <option value="stillborn">{t('breed.mode.stillborn')}</option>
            <option value="died_at_birth">{t('breed.mode.diedAtBirth')}</option>
          </Select>
          {r.mode === 'link' ? (
            <Select
              label={t('common.animal')}
              value={r.animalId}
              error={errors[`offspring.${i}.animalId`]}
              onChange={(e) => update(i, { animalId: e.target.value })}
            >
              <option value="">{t('common.choose')}</option>
              {candidates
                .filter((a) => a.id !== record.dam.id)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.animalCode}
                    {a.name ? ` — ${a.name}` : ''}
                  </option>
                ))}
            </Select>
          ) : r.mode === 'register' ? (
            <>
              <TextField
                label={t('breed.codeOptional')}
                value={r.code}
                error={errors[`offspring.${i}.register.animalCode`]}
                onChange={(e) => update(i, { code: e.target.value })}
              />
              <TextField
                label={t('animals.col.name')}
                value={r.name}
                onChange={(e) => update(i, { name: e.target.value })}
              />
            </>
          ) : null}
          {r.mode !== 'link' && (
            <Select
              label={t('animals.col.sex')}
              value={r.sex}
              error={errors[`offspring.${i}.register.sex`]}
              onChange={(e) => update(i, { sex: e.target.value })}
            >
              <option value="">
                {r.mode === 'register' ? t('common.choose') : t('common.unknown')}
              </option>
              {ANIMAL_SEXES.map((s) => (
                <option key={s} value={s}>
                  {enumLabel(t, 'sex', s)}
                </option>
              ))}
            </Select>
          )}
          <Button size="sm" onClick={() => setRows((all) => all.filter((_, j) => j !== i))}>
            {t('breed.removeRow')}
          </Button>
        </div>
      ))}
      {errors['offspring'] && <Alert tone="danger">{errors['offspring']}</Alert>}
      <div className="ds-row">
        <Button
          onClick={() =>
            setRows((all) => [
              ...all,
              { mode: 'register', code: '', name: '', sex: '', animalId: '' },
            ])
          }
        >
          {t('breed.addOffspring')}
        </Button>
        <Button
          variant="primary"
          loading={busy}
          onClick={() =>
            void send(
              delivering ? 'delivery' : 'offspring',
              delivering ? { date, offspring: offspring() } : { offspring: offspring() },
              delivering ? recordDeliverySchema : undefined,
            )
          }
        >
          {delivering ? t('breed.recordDelivery') : t('breed.saveOffspring')}
        </Button>
      </div>
    </Card>
  );
}
