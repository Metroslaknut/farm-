import {
  WEIGH_METHODS,
  type AgeWindowStatus,
  type AnimalDetail,
  type FarmDetail,
  type GrowthPoint,
  type GrowthResponse,
} from '@farmplus/shared-types';
import {
  createWeightSchema,
  fieldErrorsFromDetails,
  fieldErrorsFromZod,
  thaiToday,
  type FieldErrors,
} from '@farmplus/validation';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { api } from '@/api/client';
import { RequireAuth } from '@/auth/RequireAuth';
import {
  Button,
  Card,
  OptionPicker,
  Screen,
  StateView,
  StatusBadge,
  Text,
  TextField,
} from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { useT } from '@/i18n';
import { ageText, detailsOf, localizeFieldErrors } from '@/lib/farm-ui';
import {
  GROWTH_TONE,
  growthStatusLabel,
  measurementBody,
  sourceLabel,
  type MeasurementValues,
} from '@/lib/growth';
import { errorText } from '@/lib/messages';
import { theme } from '@/theme';

const fmt = (n: number | undefined) => (n === undefined ? '—' : String(n));

function WindowLine({ label, w }: { label: string; w: AgeWindowStatus | undefined }) {
  const t = useT('farms');
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Text variant="label">{label}</Text>
      {w ? (
        <>
          <Text>
            {t(`growth.window.${w.status}`)} ·{' '}
            {t('growth.windowRange', { from: w.standard.ageFromDays, to: w.standard.ageToDays })}
            {w.ageEstimated ? ` ${t('growth.estimated')}` : ''}
          </Text>
          <Text muted>{sourceLabel(w.standard.source)}</Text>
        </>
      ) : (
        <Text muted>{t('growth.window.none')}</Text>
      )}
    </View>
  );
}

function AddMeasurement({
  farmId,
  animalId,
  onSaved,
}: {
  farmId: string;
  animalId: string;
  onSaved: () => void;
}) {
  const t = useT('farms');
  const empty: MeasurementValues = {
    weighedOn: thaiToday(),
    weightKg: '',
    heightCm: '',
    lengthCm: '',
    method: 'scale',
    bodyCondition: '',
    notes: '',
  };
  const [v, setV] = useState(empty);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof MeasurementValues) => (value: string) =>
    setV((s) => ({ ...s, [k]: value }));

  const submit = async () => {
    const parsed = createWeightSchema.safeParse(measurementBody(animalId, v));
    if (!parsed.success) return setErrors(localizeFieldErrors(fieldErrorsFromZod(parsed.error)));
    setBusy(true);
    setErrors({});
    try {
      await api.request('POST', `/farms/${farmId}/weights`, { body: parsed.data });
      setV(empty);
      onSaved();
    } catch (e) {
      const fromApi = fieldErrorsFromDetails(detailsOf(e));
      setErrors(
        Object.keys(fromApi).length > 0 ? localizeFieldErrors(fromApi) : { _form: errorText(e) },
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <Text variant="heading">{t('growth.add')}</Text>
      <TextField
        label={t('growth.date')}
        hint={t('form.dateHint')}
        value={v.weighedOn}
        onChangeText={set('weighedOn')}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        error={errors['weighedOn']}
      />
      <TextField
        label={t('growth.weightKg')}
        value={v.weightKg}
        onChangeText={set('weightKg')}
        keyboardType="decimal-pad"
        error={errors['weightKg']}
      />
      <TextField
        label={t('growth.heightCm')}
        value={v.heightCm}
        onChangeText={set('heightCm')}
        keyboardType="decimal-pad"
        error={errors['heightCm']}
      />
      <TextField
        label={t('growth.lengthCm')}
        value={v.lengthCm}
        onChangeText={set('lengthCm')}
        keyboardType="decimal-pad"
        error={errors['lengthCm']}
      />
      <OptionPicker
        label={t('growth.method')}
        value={v.method}
        onChange={set('method')}
        options={WEIGH_METHODS.map((m) => ({ value: m, label: t(`growth.methods.${m}`) }))}
      />
      <TextField
        label={t('growth.bodyCondition')}
        hint={t('growth.bodyConditionHint')}
        value={v.bodyCondition}
        onChangeText={set('bodyCondition')}
        error={errors['bodyCondition']}
      />
      <TextField
        label={t('form.notes')}
        value={v.notes}
        onChangeText={set('notes')}
        multiline
        error={errors['notes']}
      />
      {errors['_form'] ? (
        <Text
          color={theme.colors.error.fg}
          accessibilityRole="alert"
        >{`⚠ ${errors['_form']}`}</Text>
      ) : null}
      <Button title={t('growth.save')} loading={busy} onPress={submit} />
    </Card>
  );
}

function PointRow({ p, birthDate }: { p: GrowthPoint; birthDate: string | undefined }) {
  const t = useT('farms');
  const age = birthDate ? ageText(birthDate, new Date(`${p.date}T12:00:00Z`)) : undefined;
  return (
    <View
      style={{
        gap: theme.spacing.xs,
        paddingVertical: theme.spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      }}
    >
      <Text variant="label">
        {p.date}
        {age ? ` · ${age}` : ''}
      </Text>
      <Text>
        {t('growth.pointLine', {
          kg: p.weightKg,
          height: fmt(p.heightCm),
          length: fmt(p.lengthCm),
        })}
      </Text>
      {p.evaluation.metrics.weight ? (
        <Text muted>
          {t('growth.criterionLine', {
            min: fmt(p.evaluation.metrics.weight.min),
            max: fmt(p.evaluation.metrics.weight.max),
          })}
        </Text>
      ) : null}
      {p.bodyCondition ? <Text muted>{p.bodyCondition}</Text> : null}
      <StatusBadge
        tone={GROWTH_TONE[p.evaluation.status]}
        label={growthStatusLabel(p.evaluation.status)}
      />
    </View>
  );
}

/** `/animal/growth/:id` — measurements against the admin-set criteria, alerts, age windows, and a quick entry form. */
function Growth() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT('farms');
  const [version, setVersion] = useState(0);
  const animal = useAsync(
    (signal) => api.request<{ animal: AnimalDetail }>('GET', `/animals/${id}`, { signal }),
    [id],
  );
  const farmId = animal.data?.animal.farmId;
  const farm = useAsync(
    async (signal) =>
      farmId
        ? (await api.request<{ farm: FarmDetail }>('GET', `/farms/${farmId}`, { signal })).farm
        : null,
    [farmId],
  );
  const growth = useAsync(
    async (signal) =>
      farmId
        ? api.request<GrowthResponse>('GET', `/farms/${farmId}/animals/${id}/growth`, { signal })
        : null,
    [farmId, id, version],
  );
  const error = animal.error ?? farm.error ?? growth.error;
  if (error)
    return (
      <StateView
        kind="error"
        error={error}
        onRetry={() => {
          animal.reload();
          growth.reload();
        }}
      />
    );
  if (!animal.data || !farm.data || !growth.data)
    return <StateView kind="loading" label={t('growth.loading')} />;
  const a = animal.data.animal;
  const g = growth.data;
  const canWrite =
    farm.data.status === 'active' &&
    !a.archived &&
    farm.data.access.permissions.includes('records.write');
  const points = [...g.points].reverse();
  return (
    <Screen>
      <Text variant="title">{t('growth.title', { code: a.animalCode })}</Text>
      <Text>
        {g.age.days === undefined
          ? t('growth.ageUnknown')
          : `${t('growth.ageToday')}: ${ageText(g.age.birthDate) ?? ''}${g.age.estimated ? ` ${t('growth.estimated')}` : ''}`}
      </Text>
      {g.age.estimated ? <Text muted>{t('growth.estimatedNote')}</Text> : null}
      {g.alerts.length > 0 ? (
        <Card>
          <Text variant="heading">{t('growth.alertsTitle')}</Text>
          {g.alerts.map((al) => (
            <StatusBadge
              key={al.metric}
              tone={al.code === 'LATEST_BELOW_STANDARD' ? 'error' : 'warning'}
              label={t(
                al.code === 'LATEST_BELOW_STANDARD' ? 'growth.alertBelow' : 'growth.alertAbove',
                {
                  metric: t(`growth.metric.${al.metric}`),
                  value: al.value,
                  min: fmt(al.min),
                  max: fmt(al.max),
                  date: al.date,
                },
              )}
            />
          ))}
        </Card>
      ) : null}
      <Card>
        <Text variant="heading">{t('growth.criteria')}</Text>
        {g.standards.length === 0 ? <Text muted>{t('growth.noCriteria')}</Text> : null}
        {g.standards.map((s) => (
          <View key={s.id} style={{ gap: theme.spacing.xs }}>
            <Text>
              {t('growth.criterionRange', {
                from: s.ageFromDays,
                to: s.ageToDays,
                min: fmt(s.minWeightKg),
                max: fmt(s.maxWeightKg),
              })}
            </Text>
            <Text muted>{sourceLabel(s.source)}</Text>
          </View>
        ))}
        <WindowLine label={t('growth.windowBreeding')} w={g.windows.breeding} />
        <WindowLine label={t('growth.windowSale')} w={g.windows.sale} />
      </Card>
      {canWrite ? (
        <AddMeasurement
          farmId={a.farmId}
          animalId={a.id}
          onSaved={() => setVersion((n) => n + 1)}
        />
      ) : null}
      <Card>
        <Text variant="heading">{t('growth.history', { count: g.summary.count })}</Text>
        {points.length === 0 ? <Text muted>{t('growth.empty')}</Text> : null}
        {points.map((p) => (
          <PointRow key={p.id} p={p} birthDate={g.age.birthDate} />
        ))}
      </Card>
    </Screen>
  );
}

export default function GrowthScreen() {
  return (
    <RequireAuth>
      <Growth />
    </RequireAuth>
  );
}
