import { useLocalSearchParams } from 'expo-router';

import { PlaceholderScreen } from '@/components/ui';
import { useT } from '@/i18n';

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT('common');
  return (
    <PlaceholderScreen
      title={t('placeholder.product.title')}
      description={t('placeholder.product.description')}
      params={{ id }}
    />
  );
}
