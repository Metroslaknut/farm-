import { Card, Screen, StatusBadge, Text } from '@/components/ui';
import { useT } from '@/i18n';

/** Shown instead of the app when the API URL is missing/invalid (e.g. a production build without EXPO_PUBLIC_API_BASE_URL). */
export function ConfigErrorScreen({ reason }: { reason: string }) {
  const t = useT('common');
  return (
    <Screen>
      <Text variant="title">FARM+</Text>
      <Card>
        <StatusBadge tone="error" label={t('config.badge')} />
        <Text>{reason}</Text>
        <Text muted>{t('config.body')}</Text>
      </Card>
    </Screen>
  );
}
