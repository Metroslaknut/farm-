import {
  createFarmSchema,
  fieldErrorsFromDetails,
  fieldErrorsFromZod,
  type FieldErrors,
} from '@farmplus/validation';
import type { FarmSummary } from '@farmplus/shared-types';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { api } from '@/api/client';
import { RequireAuth } from '@/auth/RequireAuth';
import { Button, Screen, Text, TextField } from '@/components/ui';
import { useT } from '@/i18n';
import { detailsOf, localizeFieldErrors } from '@/lib/farm-ui';
import { errorText } from '@/lib/messages';
import { theme } from '@/theme';

const compact = (o: Record<string, string>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v.trim() !== ''));

function NewFarmForm() {
  const router = useRouter();
  const t = useT('farms');
  /** Sent by the My Farm guard: farm setup cannot be skipped, so there is no way back. */
  const required = useLocalSearchParams<{ setup?: string }>().setup === '1';
  const [v, setV] = useState({
    name: '',
    description: '',
    province: '',
    district: '',
    postalCode: '',
    phone: '',
    email: '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const bind = (key: keyof typeof v, label: string, extra: object = {}) => (
    <TextField
      label={label}
      value={v[key]}
      onChangeText={(text) => setV({ ...v, [key]: text })}
      error={errors[key] ?? errors[`location.${key}`] ?? errors[`contact.${key}`]}
      {...extra}
    />
  );

  const submit = async () => {
    const parsed = createFarmSchema.safeParse({
      name: v.name.trim(),
      ...(v.description.trim() ? { description: v.description.trim() } : {}),
      location: compact({ province: v.province, district: v.district, postalCode: v.postalCode }),
      contact: compact({ phone: v.phone, email: v.email }),
    });
    if (!parsed.success) return setErrors(localizeFieldErrors(fieldErrorsFromZod(parsed.error)));
    setBusy(true);
    setErrors({});
    try {
      const res = await api.request<{ farm: FarmSummary }>('POST', '/farms', { body: parsed.data });
      router.replace(`/farm/${res.farm.id}`);
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
    <Screen>
      {required ? (
        <>
          <Stack.Screen
            options={{ title: t('setup.title'), headerBackVisible: false, gestureEnabled: false }}
          />
          <Text variant="title">{t('setup.title')}</Text>
          <Text muted>{t('setup.intro')}</Text>
        </>
      ) : null}
      {bind('name', t('newFarm.name'))}
      {bind('description', t('newFarm.description'), { multiline: true })}
      {bind('province', t('newFarm.province'))}
      {bind('district', t('newFarm.district'))}
      {bind('postalCode', t('newFarm.postalCode'), { keyboardType: 'number-pad', maxLength: 5 })}
      {bind('phone', t('newFarm.phone'), { keyboardType: 'phone-pad' })}
      {bind('email', t('newFarm.email'), { keyboardType: 'email-address', autoCapitalize: 'none' })}
      {errors['_form'] ? (
        <Text
          color={theme.colors.error.fg}
          accessibilityRole="alert"
        >{`⚠ ${errors['_form']}`}</Text>
      ) : null}
      <Button title={t('newFarm.submit')} loading={busy} onPress={submit} />
    </Screen>
  );
}

export default function NewFarmScreen() {
  return (
    <RequireAuth>
      <NewFarmForm />
    </RequireAuth>
  );
}
