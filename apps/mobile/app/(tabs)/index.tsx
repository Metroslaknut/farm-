import { useRouter } from 'expo-router';
import { publicApi } from '@/api/public';
import { Card, PressableCard, Screen, StateView, StatusBadge, Text } from '@/components/ui';
import { appConfig } from '@/config/env';
import { useAsync } from '@/hooks/useAsync';
import { useT } from '@/i18n';

export default function HomeScreen() {
  const router = useRouter();
  const t = useT('home');
  const health = useAsync((signal) => publicApi.getHealth(signal), []);

  return (
    <Screen>
      <Text variant="title">FARM+</Text>
      <Text muted>{t('tagline')}</Text>

      <Card>
        <Text variant="label" muted>
          {t('connection')}
        </Text>
        {health.error ? (
          <StateView kind="error" error={health.error} onRetry={health.reload} />
        ) : health.loading || !health.data ? (
          <StateView kind="loading" label={t('checking')} />
        ) : (
          <StatusBadge
            tone="success"
            label={t('connected', { environment: health.data.environment })}
          />
        )}
        {__DEV__ && appConfig.apiBaseUrl ? (
          <Text variant="caption" muted>
            API: {appConfig.apiBaseUrl}
          </Text>
        ) : null}
      </Card>

      <PressableCard
        accessibilityLabel={t('community.open')}
        onPress={() => router.push('/community')}
      >
        <Text variant="heading">{t('community.title')}</Text>
        <Text muted>{t('community.body')}</Text>
      </PressableCard>
      <PressableCard
        accessibilityLabel={t('notifications.open')}
        onPress={() => router.push('/notifications')}
      >
        <Text variant="heading">{t('notifications.title')}</Text>
        <Text muted>{t('notifications.body')}</Text>
      </PressableCard>
      <PressableCard accessibilityLabel={t('wallet.open')} onPress={() => router.push('/wallet')}>
        <Text variant="heading">{t('wallet.title')}</Text>
        <Text muted>{t('wallet.body')}</Text>
      </PressableCard>
      <PressableCard accessibilityLabel={t('chats.open')} onPress={() => router.push('/chat')}>
        <Text variant="heading">{t('chats.title')}</Text>
        <Text muted>{t('chats.body')}</Text>
      </PressableCard>
    </Screen>
  );
}
