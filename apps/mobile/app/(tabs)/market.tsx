import type { CursorPage, ListingDTO, ListingSort } from '@farmplus/shared-types';
import { parseBahtToMinor } from '@farmplus/shared-utils';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { RequireAuth } from '@/auth/RequireAuth';
import { Button, OptionPicker, StateView, Text, TextField } from '@/components/ui';
import { ListingCard } from '@/components/market/ListingCard';
import { useCursorList } from '@/hooks/useCursorList';
import { useT } from '@/i18n';
import { theme } from '@/theme';

interface Filters {
  q: string;
  province: string;
  maxPrice: string;
  sort: ListingSort;
}
const EMPTY: Filters = { q: '', province: '', maxPrice: '', sort: 'newest' };

function Market() {
  const t = useT('market');
  const router = useRouter();
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [priceInvalid, setPriceInvalid] = useState(false);
  const max = applied.maxPrice ? parseBahtToMinor(applied.maxPrice) : undefined;
  const list = useCursorList<ListingDTO>(
    (cursor, signal) =>
      api.request<CursorPage<ListingDTO>>('GET', '/marketplace/listings', {
        query: {
          limit: 10,
          sort: applied.sort,
          ...(applied.q ? { q: applied.q } : {}),
          ...(applied.province ? { province: applied.province } : {}),
          ...(max !== undefined ? { maxPriceMinor: max } : {}),
          ...(cursor ? { cursor } : {}),
        },
        signal,
      }),
    [applied],
  );

  const search = () => {
    if (draft.maxPrice && parseBahtToMinor(draft.maxPrice) === undefined)
      return setPriceInvalid(true);
    setPriceInvalid(false);
    setApplied(draft);
  };

  const header = (
    <View style={styles.header}>
      <Text variant="title">{t('browse.title')}</Text>
      <View style={styles.row}>
        <Button
          title={t('browse.saved')}
          variant="secondary"
          onPress={() => router.push('/marketplace/favorites')}
        />
        <Button
          title={t('browse.myOffers')}
          variant="secondary"
          onPress={() => router.push('/marketplace/offers')}
        />
      </View>
      <TextField
        label={t('browse.searchLabel')}
        value={draft.q}
        onChangeText={(q) => setDraft((d) => ({ ...d, q }))}
        returnKeyType="search"
        onSubmitEditing={search}
      />
      <TextField
        label={t('browse.province')}
        value={draft.province}
        onChangeText={(province) => setDraft((d) => ({ ...d, province }))}
      />
      <TextField
        label={t('browse.maxPrice')}
        value={draft.maxPrice}
        onChangeText={(maxPrice) => setDraft((d) => ({ ...d, maxPrice }))}
        keyboardType="decimal-pad"
        error={priceInvalid ? t('browse.maxPriceInvalid') : undefined}
      />
      <OptionPicker
        label={t('browse.sortBy')}
        value={draft.sort}
        onChange={(v) => setDraft((d) => ({ ...d, sort: v as ListingSort }))}
        options={[
          { value: 'newest', label: t('browse.sort.newest') },
          { value: 'price_asc', label: t('browse.sort.priceAsc') },
          { value: 'price_desc', label: t('browse.sort.priceDesc') },
        ]}
      />
      <Button title={t('browse.searchButton')} onPress={search} />
    </View>
  );

  if (list.error && list.items.length === 0)
    return (
      <View style={styles.fill}>
        {header}
        <StateView kind="error" error={list.error} onRetry={list.reload} />
      </View>
    );
  return (
    <FlatList
      style={styles.fill}
      contentContainerStyle={styles.content}
      data={list.items}
      keyExtractor={(l) => l.id}
      ListHeaderComponent={header}
      ListEmptyComponent={
        list.loading ? (
          <StateView kind="loading" label={t('browse.loading')} />
        ) : (
          <StateView
            kind="empty"
            title={t('browse.emptyTitle')}
            message={t('browse.emptyMessage')}
          />
        )
      }
      ListFooterComponent={list.loadingMore ? <StateView kind="loading" /> : null}
      refreshControl={<RefreshControl refreshing={false} onRefresh={list.reload} />}
      onEndReached={list.loadMore}
      onEndReachedThreshold={0.4}
      renderItem={({ item }) => <ListingCard listing={item} />}
    />
  );
}

export default function MarketTab() {
  return (
    <RequireAuth>
      <Market />
    </RequireAuth>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.lg, gap: theme.spacing.lg },
  header: { gap: theme.spacing.md },
  row: { flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' },
});
