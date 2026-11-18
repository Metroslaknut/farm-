import {
  ANIMAL_STATUSES,
  type AnimalSummary,
  type FarmDetail,
  type Page,
} from '@farmplus/shared-types';
import { humanize } from '@farmplus/shared-utils';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { RequireAuth } from '@/auth/RequireAuth';
import {
  Button,
  OptionPicker,
  PressableCard,
  StateView,
  StatusBadge,
  Text,
  TextField,
} from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { usePagedList } from '@/hooks/usePagedList';
import { useT } from '@/i18n';
import { ageText, ANIMAL_TONE, sexLabel, statusLabel } from '@/lib/farm-ui';
import { theme } from '@/theme';

function AnimalList() {
  const { id, animalTypeId = '' } = useLocalSearchParams<{ id: string; animalTypeId?: string }>();
  const router = useRouter();
  const t = useT('farms');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [archived, setArchived] = useState('false');
  const farm = useAsync(
    (signal) => api.request<{ farm: FarmDetail }>('GET', `/farms/${id}`, { signal }),
    [id],
  );
  const list = usePagedList<AnimalSummary>(
    (page, signal) =>
      api.request<Page<AnimalSummary>>('GET', `/farms/${id}/animals`, {
        query: {
          page,
          pageSize: 20,
          q,
          status,
          archived,
          ...(animalTypeId ? { animalTypeId } : {}),
          sortBy: 'createdAt',
          order: 'desc',
        },
        signal,
      }),
    [id, q, status, archived, animalTypeId],
  );
  const canWrite =
    farm.data?.farm.access.permissions.includes('animals.write') &&
    farm.data.farm.status === 'active';

  const header = (
    <View style={styles.header}>
      <TextField
        label={t('list.search')}
        value={search}
        onChangeText={setSearch}
        onSubmitEditing={() => setQ(search.trim())}
        returnKeyType="search"
        autoCapitalize="none"
      />
      <OptionPicker
        label={t('list.status')}
        allowEmpty
        emptyLabel={t('list.all')}
        value={status}
        onChange={setStatus}
        options={ANIMAL_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))}
      />
      <OptionPicker
        label={t('list.records')}
        value={archived}
        onChange={setArchived}
        options={[
          { value: 'false', label: t('list.current') },
          { value: 'true', label: t('list.archived') },
          { value: 'all', label: t('list.all') },
        ]}
      />
      <Button
        title={t('list.searchButton')}
        variant="secondary"
        onPress={() => setQ(search.trim())}
      />
      {canWrite ? (
        <Button
          title={t('action.registerAnimal')}
          onPress={() => router.push(`/farm/${id}/animals/new`)}
        />
      ) : null}
      <Text variant="caption" muted>
        {t('list.total', { count: list.total })}
      </Text>
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
      keyExtractor={(a) => a.id}
      ListHeaderComponent={header}
      ListEmptyComponent={
        list.loading ? (
          <StateView kind="loading" label={t('list.loading')} />
        ) : (
          <StateView kind="empty" title={t('list.emptyTitle')} message={t('list.emptyMessage')} />
        )
      }
      ListFooterComponent={list.loadingMore ? <StateView kind="loading" /> : null}
      refreshControl={<RefreshControl refreshing={false} onRefresh={list.reload} />}
      onEndReached={list.loadMore}
      onEndReachedThreshold={0.4}
      renderItem={({ item: a }) => (
        <PressableCard
          accessibilityLabel={t('list.openAnimal', {
            label: `${a.animalCode}${a.name ? ` ${a.name}` : ''}`,
          })}
          onPress={() => router.push(`/animal/${a.id}`)}
        >
          <Text variant="heading">
            {a.animalCode}
            {a.name ? ` — ${a.name}` : ''}
          </Text>
          <Text muted>
            {[
              a.animalType.name,
              a.breedName ?? (a.breed && humanize(a.breed)),
              sexLabel(a.sex),
              ageText(a.birthDate),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <View style={styles.row}>
            <StatusBadge tone={ANIMAL_TONE[a.currentStatus]} label={statusLabel(a.currentStatus)} />
            {a.archived ? <StatusBadge tone="warning" label={t('badge.archived')} /> : null}
          </View>
        </PressableCard>
      )}
    />
  );
}

export default function AnimalListScreen() {
  return (
    <RequireAuth>
      <AnimalList />
    </RequireAuth>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md },
  header: { gap: theme.spacing.md, marginBottom: theme.spacing.sm },
  row: { flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' },
});
