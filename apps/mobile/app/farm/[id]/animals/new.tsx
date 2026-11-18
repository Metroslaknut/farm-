import type { FarmDetail } from '@farmplus/shared-types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/api/client';
import { RequireAuth } from '@/auth/RequireAuth';
import { AnimalForm } from '@/components/farm/AnimalForm';
import { Screen, StateView, Text } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { useT } from '@/i18n';

/** `/farm/:id/animals/new` — register an animal (the form is shared with the edit screen). */
function NewAnimal() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useT('farms');
  const farm = useAsync(
    (signal) => api.request<{ farm: FarmDetail }>('GET', `/farms/${id}`, { signal }),
    [id],
  );

  if (farm.error) return <StateView kind="error" error={farm.error} onRetry={farm.reload} />;
  if (!farm.data) return <StateView kind="loading" />;
  const f = farm.data.farm;
  if (f.status === 'archived' || !f.access.permissions.includes('animals.write')) {
    return (
      <Screen>
        <Text>{f.status === 'archived' ? t('form.farmArchived') : t('form.noPermission')}</Text>
      </Screen>
    );
  }
  return <AnimalForm farmId={id} onSaved={(saved) => router.replace(`/animal/${saved.id}`)} />;
}

export default function NewAnimalScreen() {
  return (
    <RequireAuth>
      <NewAnimal />
    </RequireAuth>
  );
}
