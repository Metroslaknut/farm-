import type { FarmAnimalSummaryDTO, FarmDetail } from '@farmplus/shared-types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';
import { api } from '@/api/client';
import { RequireAuth } from '@/auth/RequireAuth';
import { Button, Card, PressableCard, Screen, StateView, StatusBadge, Text } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { getLocale, useT } from '@/i18n';
import { ANIMAL_TONE, roleLabel, statusLabel } from '@/lib/farm-ui';
import { theme } from '@/theme';

function FarmOverview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useT('farms');
  const { data, error, loading, reload } = useAsync(
    (signal) => api.request<{ farm: FarmDetail }>('GET', `/farms/${id}`, { signal }),
    [id],
  );

  if (error) return <StateView kind="error" error={error} onRetry={reload} />;
  if (loading || !data) return <StateView kind="loading" label={t('overview.loading')} />;
  const farm = data.farm;
  const can = (p: string) => farm.access.permissions.includes(p as never);
  const place = [
    farm.location.address,
    farm.location.subdistrict,
    farm.location.district,
    farm.location.province,
    farm.location.postalCode,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Screen>
      <Text variant="title">{farm.name}</Text>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
        <StatusBadge
          tone="neutral"
          label={farm.myRole ? roleLabel(farm.myRole) : t('role.platform')}
        />
        {farm.status === 'archived' ? (
          <StatusBadge tone="warning" label={t('badge.archivedReadOnly')} />
        ) : null}
      </View>
      {farm.description ? <Text>{farm.description}</Text> : null}

      <Card>
        <Text variant="heading">{t('overview.animals')}</Text>
        <Text>
          {t('overview.animalCounts', {
            total: farm.stats.animalsTotal,
            active: farm.stats.animalsActive,
          })}
        </Text>
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
          {Object.entries(farm.stats.byStatus).map(([status, count]) => (
            <StatusBadge
              key={status}
              tone={ANIMAL_TONE[status as keyof typeof ANIMAL_TONE] ?? 'neutral'}
              label={t('overview.statusCount', { status: statusLabel(status), count })}
            />
          ))}
        </View>
        <Button
          title={t('overview.viewAnimals')}
          variant="secondary"
          onPress={() => router.push(`/farm/${farm.id}/animals`)}
        />
        {can('animals.write') && farm.status === 'active' ? (
          <Button
            title={t('action.registerAnimal')}
            onPress={() => router.push(`/farm/${farm.id}/animals/new`)}
          />
        ) : null}
      </Card>

      {can('animals.read') ? <AnimalSummary farmId={farm.id} /> : null}

      <Card>
        <Text variant="heading">{t('overview.locationContact')}</Text>
        <Text>{place || t('location.notSet')}</Text>
        <Text muted>
          {[
            farm.contact.phone,
            farm.contact.email,
            farm.contact.lineId && t('overview.lineId', { id: farm.contact.lineId }),
          ]
            .filter(Boolean)
            .join(' · ') || t('overview.noContact')}
        </Text>
      </Card>
    </Screen>
  );
}

/** Live per-type counts (types are admin-managed data from the API, never hard-coded). */
function AnimalSummary({ farmId }: { farmId: string }) {
  const router = useRouter();
  const t = useT('farms');
  const { data, error, reload } = useAsync(
    (signal) => api.request<FarmAnimalSummaryDTO>('GET', `/farms/${farmId}/summary`, { signal }),
    [farmId],
  );
  if (error) return <StateView kind="error" error={error} onRetry={reload} />;
  if (!data) return <StateView kind="loading" label={t('summary.loading')} />;
  const name = (c: { name: string; nameTh?: string }) =>
    (getLocale() === 'th' && c.nameTh) || c.name;
  return (
    <>
      <Card>
        <Text variant="heading">{t('summary.title')}</Text>
        <Text>
          {t('summary.totals', {
            total: data.totals.total,
            onFarm: data.totals.onFarm,
            forSale: data.totals.forSale,
            sold: data.totals.sold,
          })}
        </Text>
        {data.totals.needsGrowthCheck ? (
          <StatusBadge
            tone="warning"
            label={t('summary.growthCheck', {
              count: data.totals.needsGrowthCheck,
              days: data.growthCheckDays,
            })}
          />
        ) : null}
        {data.trade ? (
          <Text muted>
            {t('summary.trade', {
              listings: data.trade.listingsTotal,
              orders: data.trade.animalOrders,
            })}
          </Text>
        ) : null}
      </Card>
      <Text variant="heading">{t('summary.byType')}</Text>
      {data.byType.length === 0 ? <Text muted>{t('summary.empty')}</Text> : null}
      {data.byType.map((c) => (
        <PressableCard
          key={c.animalTypeId}
          accessibilityLabel={t('summary.openType', { name: name(c) })}
          onPress={() => router.push(`/farm/${farmId}/animals?animalTypeId=${c.animalTypeId}`)}
        >
          <Text variant="heading">{name(c)}</Text>
          <Text>
            {t('summary.typeCounts', { total: c.total, forSale: c.forSale, sold: c.sold })}
          </Text>
        </PressableCard>
      ))}
    </>
  );
}

export default function FarmOverviewScreen() {
  return (
    <RequireAuth>
      <FarmOverview />
    </RequireAuth>
  );
}
