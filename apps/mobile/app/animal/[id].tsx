import type { AnimalDetail, FarmDetail } from '@farmplus/shared-types';
import { humanize } from '@farmplus/shared-utils';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Linking, Pressable, View } from 'react-native';
import { api } from '@/api/client';
import { RequireAuth } from '@/auth/RequireAuth';
import { Button, Card, Screen, StateView, StatusBadge, Text } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { confirmAction } from '@/lib/confirm';
import { useT } from '@/i18n';
import { ageText, ANIMAL_TONE, originLabel, sexLabel, statusLabel } from '@/lib/farm-ui';
import { errorText } from '@/lib/messages';
import { theme } from '@/theme';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
      <Text variant="label" muted style={{ width: 110 }}>
        {label}
      </Text>
      <View style={{ flex: 1 }}>
        {typeof children === 'string' ? <Text>{children}</Text> : children}
      </View>
    </View>
  );
}

function AnimalDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useT('farms');
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  // The animal id alone is enough (deep links): the API authorises through the animal's farm.
  const animal = useAsync(
    (signal) => api.request<{ animal: AnimalDetail }>('GET', `/animals/${id}`, { signal }),
    [id, version],
  );
  const farmId = animal.data?.animal.farmId;
  const farm = useAsync(
    async (signal) =>
      farmId
        ? (await api.request<{ farm: FarmDetail }>('GET', `/farms/${farmId}`, { signal })).farm
        : null,
    [farmId],
  );

  if (animal.error) return <StateView kind="error" error={animal.error} onRetry={animal.reload} />;
  if (animal.loading || !animal.data)
    return <StateView kind="loading" label={t('detail.loading')} />;
  const a = animal.data.animal;
  const canArchive =
    farm.data?.status === 'active' && farm.data.access.permissions.includes('animals.archive');

  const act = async (path: 'archive' | 'restore') => {
    setBusy(true);
    setActionError(undefined);
    try {
      await api.request('POST', `/farms/${a.farmId}/animals/${a.id}/${path}`, { body: {} });
      setVersion((n) => n + 1);
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const confirmArchive = async () => {
    const ok = await confirmAction(
      t('detail.archiveTitle', { code: a.animalCode }),
      t('detail.archiveMessage'),
      t('detail.archive'),
    );
    if (ok) await act('archive');
  };

  return (
    <Screen>
      <Text variant="title">
        {a.animalCode}
        {a.name ? ` — ${a.name}` : ''}
      </Text>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
        <StatusBadge tone={ANIMAL_TONE[a.currentStatus]} label={statusLabel(a.currentStatus)} />
        {a.archived ? <StatusBadge tone="warning" label={t('badge.archivedReadOnly')} /> : null}
      </View>
      {a.archived && a.archiveReason ? (
        <Text muted>{t('detail.reason', { reason: a.archiveReason })}</Text>
      ) : null}
      {actionError ? (
        <Text color={theme.colors.error.fg} accessibilityRole="alert">{`⚠ ${actionError}`}</Text>
      ) : null}

      <Card>
        <Row label={t('detail.type')}>
          {[a.animalType.name, a.breedName ?? (a.breed && humanize(a.breed))]
            .filter(Boolean)
            .join(' · ')}
        </Row>
        <Row label={t('detail.sex')}>{sexLabel(a.sex)}</Row>
        <Row label={t('detail.born')}>
          {a.birthDate
            ? t(a.birthDateEstimated ? 'detail.bornEstimated' : 'detail.bornValue', {
                date: a.birthDate,
                age: ageText(a.birthDate) ?? '',
              })
            : '—'}
        </Row>
        <Row label={t('detail.acquired')}>{a.acquisitionDate ?? '—'}</Row>
        <Row
          label={t('detail.origin')}
        >{`${originLabel(a.origin.kind)}${a.origin.note ? ` — ${a.origin.note}` : ''}`}</Row>
        <Row label={t('detail.sire')}>
          {a.sire ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push(`/animal/${a.sire!.id}`)}
            >
              <Text color={theme.colors.primary}>
                {a.sire.animalCode}
                {a.sire.name ? ` — ${a.sire.name}` : ''}
              </Text>
            </Pressable>
          ) : (
            t('detail.unknown')
          )}
        </Row>
        <Row label={t('detail.dam')}>
          {a.dam ? (
            <Pressable accessibilityRole="link" onPress={() => router.push(`/animal/${a.dam!.id}`)}>
              <Text color={theme.colors.primary}>
                {a.dam.animalCode}
                {a.dam.name ? ` — ${a.dam.name}` : ''}
              </Text>
            </Pressable>
          ) : (
            t('detail.unknown')
          )}
        </Row>
        <Row label={t('detail.offspring')}>{String(a.offspringCount)}</Row>
        {a.color ? <Row label={t('detail.color')}>{a.color}</Row> : null}
        {a.notes ? <Row label={t('detail.notes')}>{a.notes}</Row> : null}
      </Card>

      <Card>
        <Text variant="heading">{t('detail.media', { count: a.media.length })}</Text>
        {a.media.length === 0 ? <Text muted>{t('detail.noFiles')}</Text> : null}
        {a.media.map((m) =>
          m.kind === 'photo' ? (
            <Image
              key={m.id}
              source={{ uri: m.url }}
              accessibilityLabel={m.caption ?? t('detail.photoOf', { code: a.animalCode })}
              style={{
                width: '100%',
                height: 200,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surfaceAlt,
              }}
              resizeMode="cover"
            />
          ) : (
            <Pressable
              key={m.id}
              accessibilityRole="link"
              accessibilityLabel={t('detail.openDocument', { caption: m.caption ?? '' })}
              onPress={() => void Linking.openURL(m.url)}
              style={{ minHeight: theme.minTouch, justifyContent: 'center' }}
            >
              <Text color={theme.colors.primary}>📄 {m.caption ?? m.url}</Text>
            </Pressable>
          ),
        )}
      </Card>

      {farm.data?.access.permissions.includes('records.read') ? (
        <Button
          title={t('detail.growth')}
          variant="secondary"
          onPress={() => router.push(`/animal/growth/${a.id}`)}
        />
      ) : null}
      {farm.data?.status === 'active' &&
      !a.archived &&
      farm.data.access.permissions.includes('animals.write') ? (
        <Button title={t('detail.edit')} onPress={() => router.push(`/animal/edit/${a.id}`)} />
      ) : null}
      {canArchive && !a.archived ? (
        <Button
          title={t('detail.archive')}
          variant="secondary"
          loading={busy}
          onPress={() => void confirmArchive()}
        />
      ) : null}
      {canArchive && a.archived ? (
        <Button title={t('detail.restore')} loading={busy} onPress={() => void act('restore')} />
      ) : null}
    </Screen>
  );
}

export default function AnimalScreen() {
  return (
    <RequireAuth>
      <AnimalDetails />
    </RequireAuth>
  );
}
