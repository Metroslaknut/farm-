import { usePathname, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { StateView, Button, Card, Screen, Text } from '@/components/ui';
import { useT } from '@/i18n';
import { useAuth } from './AuthProvider';

/** Gate for screens that need an account. Anonymous users get a sign-in prompt that returns them here afterwards. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const t = useT('common');

  if (status === 'loading') return <StateView kind="loading" label={t('requireAuth.checking')} />;
  if (status === 'anonymous') {
    return (
      <Screen>
        <Card>
          <Text variant="heading">{t('requireAuth.title')}</Text>
          <Text muted>{t('requireAuth.body')}</Text>
          <Button
            title={t('requireAuth.signIn')}
            onPress={() => router.push({ pathname: '/sign-in', params: { redirect: pathname } })}
          />
        </Card>
      </Screen>
    );
  }
  return <>{children}</>;
}
