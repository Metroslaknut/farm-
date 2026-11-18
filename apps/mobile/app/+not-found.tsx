import { Link, Stack } from 'expo-router';
import { Card, Screen, Text } from '@/components/ui';
import { useT } from '@/i18n';
import { theme } from '@/theme';

export default function NotFound() {
  const t = useT('common');
  return (
    <>
      <Stack.Screen options={{ title: t('notFound.title') }} />
      <Screen>
        <Card>
          <Text variant="heading">{t('notFound.body')}</Text>
          <Link href="/" replace>
            <Text color={theme.colors.primary} variant="label">
              {t('notFound.home')}
            </Text>
          </Link>
        </Card>
      </Screen>
    </>
  );
}
