import type { FarmSetupDTO, FarmSummary, Page } from '@farmplus/shared-types';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { RequireAuth } from '@/auth/RequireAuth';
import { Button, PressableCard, StateView, StatusBadge, Text } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { usePagedList } from '@/hooks/usePagedList';
import { useT } from '@/i18n';
import { roleLabel } from '@/lib/farm-ui';
import { farmSetupRedirect } from '@/lib/farm-setup';
import { theme } from '@/theme';

/** Onboarding guard: a user who may create a farm but has none goes to the farm setup first (re-checked on focus). */
function FarmSetupGate() {
  const t = useT('farms');
  const setup = useAsync((signal) => api.request<FarmSetupDTO>('GET', '/farms/me', { signal }), []);
  const { reload } = setup;
  useFocusEffect(useCallback(() => reload(), [reload]));
  if (setup.error && !setup.data)
    return <StateView kind="error" error={setup.error} onRetry={setup.reload} />;
  if (!setup.data) return <StateView kind="loading" label={t('setup.checking')} />;
  const to = farmSetupRedirect(setup.data);
  if (to) return <Redirect href={to} />;
  return <FarmList />;
}

function FarmList() {
  const router = useRouter();
  const t = useT('farms');
  const list = usePagedList<FarmSummary>(
    (page, signal) =>
      api.request<Page<FarmSummary>>('GET', '/farms', { query: { page, pageSize: 20 }, signal }),
    [],
  );

  const header = (
    <View style={styles.header}>
      <Text variant="title">{t('myFarm.title')}</Text>
      <Button title={t('myFarm.create')} onPress={() => router.push('/farm/new')} />
    </View>
  );

  if (list.error && list.items.length === 0) {
    return (
      <View style={styles.fill}>
        {header}
        <StateView kind="error" error={list.error} onRetry={list.reload} />
      </View>
    );
  }
  return (
    <FlatList
      style={styles.fill}
      contentContainerStyle={styles.content}
      data={list.items}
      keyExtractor={(farm) => farm.id}
      ListHeaderComponent={header}
      ListEmptyComponent={
        list.loading ? (
          <StateView kind="loading" label={t('myFarm.loading')} />
        ) : (
          <StateView
            kind="empty"
            title={t('myFarm.emptyTitle')}
            message={t('myFarm.emptyMessage')}
          />
        )
      }
      ListFooterComponent={list.loadingMore ? <StateView kind="loading" /> : null}
      refreshControl={<RefreshControl refreshing={false} onRefresh={list.reload} />}
      onEndReached={list.loadMore}
      onEndReachedThreshold={0.4}
      renderItem={({ item: farm }) => (
        <PressableCard
          accessibilityLabel={t('myFarm.openFarm', { name: farm.name })}
          onPress={() => router.push(`/farm/${farm.id}`)}
        >
          <Text variant="heading">{farm.name}</Text>
          <Text muted>
            {[farm.location.district, farm.location.province].filter(Boolean).join(', ') ||
              t('location.notSet')}
          </Text>
          <View style={styles.row}>
            {farm.myRole ? <StatusBadge tone="neutral" label={roleLabel(farm.myRole)} /> : null}
            {farm.status === 'archived' ? (
              <StatusBadge tone="warning" label={t('badge.archived')} />
            ) : null}
          </View>
        </PressableCard>
      )}
    />
  );
}

export default function MyFarmTab() {
  return (
    <RequireAuth>
      <FarmSetupGate />
    </RequireAuth>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md },
  header: { gap: theme.spacing.md, marginBottom: theme.spacing.sm },
  row: { flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' },
});
