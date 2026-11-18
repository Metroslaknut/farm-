import {
  ANIMAL_ORIGINS,
  ANIMAL_SEXES,
  ANIMAL_STATUSES,
  type AnimalDetail,
  type AnimalSummary,
  type AnimalTypeSummary,
  type Page,
} from '@farmplus/shared-types';
import {
  createAnimalSchema,
  estimatedBirthDate,
  fieldErrorsFromDetails,
  fieldErrorsFromZod,
  updateAnimalSchema,
  type FieldErrors,
} from '@farmplus/validation';
import { useState } from 'react';
import { Switch, View } from 'react-native';
import { api } from '@/api/client';
import { Button, OptionPicker, Screen, StateView, Text, TextField } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { useLocale, useT } from '@/i18n';
import {
  EMPTY_ANIMAL,
  createBody,
  patchBody,
  valuesOf,
  type AnimalFormValues,
} from '@/lib/animal-form';
import { detailsOf, localizeFieldErrors, originLabel, sexLabel, statusLabel } from '@/lib/farm-ui';
import { errorText } from '@/lib/messages';
import { theme } from '@/theme';

/**
 * Register (no `animal`) or edit (`animal` given) an animal of `farmId`. The same Zod schemas as the API validate the
 * input; identity (code, type) is fixed once the animal exists. `onSaved` receives the saved animal.
 */
export function AnimalForm({
  farmId,
  animal,
  onSaved,
}: {
  farmId: string;
  animal?: AnimalDetail;
  onSaved: (saved: AnimalDetail) => void;
}) {
  const t = useT('farms');
  const [locale] = useLocale();
  const localName = (o: { name: string; nameTh?: string }) =>
    locale === 'th' && o.nameTh ? o.nameTh : o.name;
  const base = animal ? valuesOf(animal) : EMPTY_ANIMAL;
  const [v, setV] = useState<AnimalFormValues>(base);
  const [approx, setApprox] = useState({ years: '', months: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const types = useAsync(
    (signal) =>
      api.request<{ animalTypes: AnimalTypeSummary[] }>('GET', '/animal-types', { signal }),
    [],
  );
  const parents = useAsync(
    async (signal) => {
      if (!v.animalTypeId) return { sires: [] as AnimalSummary[], dams: [] as AnimalSummary[] };
      const get = (sex: string) =>
        api.request<Page<AnimalSummary>>('GET', `/farms/${farmId}/animals`, {
          query: {
            animalTypeId: v.animalTypeId,
            sex,
            pageSize: 30,
            sortBy: 'animalCode',
            order: 'asc',
          },
          signal,
        });
      const [sires, dams] = await Promise.all([get('male'), get('female')]);
      return { sires: sires.items, dams: dams.items };
    },
    [farmId, v.animalTypeId],
  );

  if (types.error) return <StateView kind="error" error={types.error} onRetry={types.reload} />;
  if (!types.data) return <StateView kind="loading" />;
  const type = types.data.animalTypes.find((at) => at.id === v.animalTypeId);
  const clear = (key: string) =>
    setErrors((e) =>
      key in e ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== key)) : e,
    );
  const set = <K extends keyof AnimalFormValues>(key: K, value: AnimalFormValues[K]) => {
    setV((s) => ({ ...s, [key]: value }));
    clear(key === 'originKind' ? 'origin.kind' : key);
  };
  const err = (key: string) => errors[key];

  /** "About N years M months" → an estimated birth date, always flagged as an estimate. */
  const applyApproxAge = () => {
    const n = (s: string) => (s.trim() === '' ? 0 : Number(s));
    const date = estimatedBirthDate(n(approx.years), n(approx.months));
    if (!date) return setErrors((e) => ({ ...e, approxAge: t('form.approxAgeInvalid') }));
    setV((s) => ({ ...s, birthDate: date, birthDateEstimated: true }));
    clear('approxAge');
    clear('birthDate');
  };

  const submit = async () => {
    const parsed = animal
      ? updateAnimalSchema.safeParse(patchBody(base, v))
      : createAnimalSchema.safeParse(createBody(v));
    if (!parsed.success) return setErrors(localizeFieldErrors(fieldErrorsFromZod(parsed.error)));
    setBusy(true);
    setErrors({});
    try {
      const res = animal
        ? await api.request<{ animal: AnimalDetail }>(
            'PATCH',
            `/farms/${farmId}/animals/${animal.id}`,
            { body: parsed.data },
          )
        : await api.request<{ animal: AnimalDetail }>('POST', `/farms/${farmId}/animals`, {
            body: parsed.data,
          });
      onSaved(res.animal);
    } catch (e) {
      const fromApi = fieldErrorsFromDetails(detailsOf(e));
      setErrors(
        Object.keys(fromApi).length > 0 ? localizeFieldErrors(fromApi) : { _form: errorText(e) },
      );
    } finally {
      setBusy(false);
    }
  };

  const label = (a: AnimalSummary) => ({
    value: a.id,
    label: `${a.animalCode}${a.name ? ` — ${a.name}` : ''}`,
  });
  const notSelf = (a: AnimalSummary) => a.id !== animal?.id;
  return (
    <Screen>
      {animal ? (
        <Text variant="title">{t('edit.title', { code: animal.animalCode })}</Text>
      ) : (
        <TextField
          label={t('form.animalCode')}
          hint={t('form.animalCodeHint')}
          value={v.animalCode}
          onChangeText={(text) => set('animalCode', text)}
          autoCapitalize="characters"
          autoCorrect={false}
          error={err('animalCode')}
        />
      )}
      {animal ? (
        <Text muted>{t('edit.identityFixed', { type: localName(animal.animalType) })}</Text>
      ) : (
        <OptionPicker
          label={t('form.animalType')}
          value={v.animalTypeId}
          onChange={(typeId) => {
            setV((s) => ({ ...s, animalTypeId: typeId, breed: '', sireId: '', damId: '' }));
            clear('animalTypeId');
          }}
          options={types.data.animalTypes.map((at) => ({ value: at.id, label: localName(at) }))}
          error={err('animalTypeId')}
        />
      )}
      {type && type.breeds.length > 0 ? (
        <OptionPicker
          label={t('form.breed')}
          allowEmpty
          emptyLabel={t('form.notSpecified')}
          value={v.breed}
          onChange={(b) => set('breed', b)}
          options={type.breeds.map((b) => ({ value: b.key, label: localName(b) }))}
          error={err('breed')}
        />
      ) : null}
      <TextField
        label={t('form.name')}
        value={v.name}
        onChangeText={(text) => set('name', text)}
        error={err('name')}
      />
      <OptionPicker
        label={t('form.sex')}
        value={v.sex}
        onChange={(s) => set('sex', s)}
        options={ANIMAL_SEXES.map((s) => ({ value: s, label: sexLabel(s) }))}
        error={err('sex')}
      />
      <OptionPicker
        label={t('form.currentStatus')}
        value={v.currentStatus}
        onChange={(s) => set('currentStatus', s)}
        options={ANIMAL_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))}
        error={err('currentStatus')}
      />
      <TextField
        label={t('form.color')}
        hint={t('form.colorHint')}
        value={v.color}
        onChangeText={(text) => set('color', text)}
        error={err('color')}
      />
      <TextField
        label={t('form.birthDate')}
        hint={t('form.dateHint')}
        value={v.birthDate}
        onChangeText={(text) => set('birthDate', text)}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        error={err('birthDate')}
      />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          minHeight: theme.minTouch,
        }}
      >
        <Switch
          accessibilityLabel={t('form.birthDateEstimated')}
          value={v.birthDateEstimated}
          onValueChange={(b) => set('birthDateEstimated', b)}
          trackColor={{ true: theme.colors.primary }}
        />
        <Text>{t('form.birthDateEstimated')}</Text>
      </View>
      <Text variant="label">{t('form.approxAge')}</Text>
      <Text muted>{t('form.approxAgeHint')}</Text>
      <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
        <View style={{ flex: 1 }}>
          <TextField
            label={t('form.approxYears')}
            value={approx.years}
            onChangeText={(years) => setApprox((x) => ({ ...x, years }))}
            keyboardType="number-pad"
            maxLength={2}
          />
        </View>
        <View style={{ flex: 1 }}>
          <TextField
            label={t('form.approxMonths')}
            value={approx.months}
            onChangeText={(months) => setApprox((x) => ({ ...x, months }))}
            keyboardType="number-pad"
            maxLength={2}
          />
        </View>
      </View>
      {err('approxAge') ? (
        <Text color={theme.colors.error.fg} accessibilityRole="alert">
          {err('approxAge')}
        </Text>
      ) : null}
      <Button title={t('form.useApproxAge')} variant="secondary" onPress={applyApproxAge} />
      <TextField
        label={t('form.acquisitionDate')}
        hint={t('form.dateHint')}
        value={v.acquisitionDate}
        onChangeText={(text) => set('acquisitionDate', text)}
        keyboardType="numbers-and-punctuation"
        maxLength={10}
        error={err('acquisitionDate')}
      />
      <OptionPicker
        label={t('form.origin')}
        value={v.originKind}
        onChange={(o) => set('originKind', o)}
        options={ANIMAL_ORIGINS.map((o) => ({ value: o, label: originLabel(o) }))}
        error={err('origin.kind')}
      />
      <TextField
        label={t('form.originNote')}
        value={v.originNote}
        onChangeText={(text) => set('originNote', text)}
        error={err('origin.note')}
      />
      {v.animalTypeId ? (
        <>
          <OptionPicker
            label={t('form.sire')}
            allowEmpty
            emptyLabel={t('form.unknown')}
            value={v.sireId}
            onChange={(s) => set('sireId', s)}
            options={(parents.data?.sires ?? []).filter(notSelf).map(label)}
            error={err('sireId')}
          />
          <OptionPicker
            label={t('form.dam')}
            allowEmpty
            emptyLabel={t('form.unknown')}
            value={v.damId}
            onChange={(s) => set('damId', s)}
            options={(parents.data?.dams ?? []).filter(notSelf).map(label)}
            error={err('damId')}
          />
        </>
      ) : null}
      <TextField
        label={t('form.notes')}
        value={v.notes}
        onChangeText={(text) => set('notes', text)}
        multiline
        error={err('notes')}
      />
      {errors['_form'] ? (
        <Text
          color={theme.colors.error.fg}
          accessibilityRole="alert"
        >{`⚠ ${errors['_form']}`}</Text>
      ) : null}
      <Button title={animal ? t('edit.save') : t('form.submit')} loading={busy} onPress={submit} />
    </Screen>
  );
}
