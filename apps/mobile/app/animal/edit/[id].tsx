import type { AnimalDetail, FarmDetail } from '@farmplus/shared-types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/api/client';
import { RequireAuth } from '@/auth/RequireAuth';
import { AnimalForm } from '@/components/farm/AnimalForm';
import { Screen, StateView, Text } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { useT } from '@/i18n';

/** `/animal/edit/:id` — edit an animal (code and type are fixed; the API re-checks every rule). */
function EditAnimal() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useT('farms');
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
  if (animal.error) return <StateView kind="error" error={animal.error} onRetry={animal.reload} />;
  if (farm.error) return <StateView kind="error" error={farm.error} onRetry={farm.reload} />;
  if (!animal.data || !farm.data) return <StateView kind="loading" label={t('detail.loading')} />;
  const a = animal.data.animal;
  const f = farm.data;
  if (f.status === 'archived' || a.archived || !f.access.permissions.includes('animals.write')) {
    return (
      <Screen>
        <Text>
          {f.status === 'archived'
            ? t('form.farmArchived')
            : a.archived
              ? t('edit.archived')
              : t('edit.noPermission')}
        </Text>
      </Screen>
    );
  }
  return <AnimalForm farmId={f.id} animal={a} onSaved={() => router.back()} />;
}

export default function EditAnimalScreen() {
  return (
    <RequireAuth>
      <EditAnimal />
    </RequireAuth>
  );
}
