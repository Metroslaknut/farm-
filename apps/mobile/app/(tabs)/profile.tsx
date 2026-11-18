import type { FarmSetupDTO } from '@farmplus/shared-types';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import {
  Button,
  Card,
  LanguageSwitch,
  PressableCard,
  Screen,
  StateView,
  StatusBadge,
  Text,
} from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { useT } from '@/i18n';

const ROLE_KEYS = [
  'super_admin',
  'admin',
  'registration_admin',
  'finance_admin',
  'moderator',
  'support',
  'farm_owner',
  'seller',
  'buyer',
] as const;
type RoleKey = (typeof ROLE_KEYS)[number];
const isRoleKey = (role: string): role is RoleKey =>
  (ROLE_KEYS as readonly string[]).includes(role);

export default function ProfileTab() {
  const { status, user, signOut } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const t = useT('profile');
  /** Known roles get a name in the current language; an unknown one is shown as sent. */
  const roleName = (role: string) => (isRoleKey(role) ? t(`role.${role}`) : role);

  if (status === 'loading') return <StateView kind="loading" />;

  if (!user) {
    return (
      <Screen>
        <Text variant="title">{t('title')}</Text>
        <Card>
          <Text variant="heading">{t('welcome')}</Text>
          <Text muted>{t('signInPrompt')}</Text>
          <Button title={t('signIn')} onPress={() => router.push('/sign-in')} />
          <Button
            title={t('createAccount')}
            variant="secondary"
            onPress={() => router.push('/register')}
          />
        </Card>
        <Card>
          <LanguageSwitch />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text variant="title">{user.displayName}</Text>
      <Card>
        <Text muted>{user.email ?? user.phone}</Text>
        <Text variant="label" muted>
          {t('roles')}
        </Text>
        <Text>{user.roles.map(roleName).join(', ')}</Text>
        <StatusBadge
          tone={user.emailVerified || user.phoneVerified ? 'success' : 'warning'}
          label={user.emailVerified || user.phoneVerified ? t('verified') : t('notVerified')}
        />
      </Card>
      <ProfileFarms />
      <Card>
        <LanguageSwitch />
      </Card>
      <Button
        title={t('signOut')}
        variant="secondary"
        loading={busy}
        onPress={async () => {
          setBusy(true);
          await signOut();
          setBusy(false);
        }}
      />
    </Screen>
  );
}

/** Farm settings live in the profile once the farm is set up (re-checked whenever the tab is focused). */
function ProfileFarms() {
  const router = useRouter();
  const t = useT('farms');
  const setup = useAsync((signal) => api.request<FarmSetupDTO>('GET', '/farms/me', { signal }), []);
  const { reload } = setup;
  useFocusEffect(useCallback(() => reload(), [reload]));
  if (setup.error && !setup.data)
    return <StateView kind="error" error={setup.error} onRetry={reload} />;
  if (!setup.data) return <StateView kind="loading" />;
  const { farms, canCreateFarm } = setup.data;
  return (
    <Card>
      <Text variant="heading">{t('profileFarms.title')}</Text>
      {farms.length === 0 ? (
        <>
          <Text muted>{t('profileFarms.none')}</Text>
          {canCreateFarm ? (
            <Button title={t('profileFarms.setup')} onPress={() => router.push('/farm/new')} />
          ) : (
            <Text muted>{t('setup.notAllowed')}</Text>
          )}
        </>
      ) : (
        farms.map((farm) => (
          <PressableCard
            key={farm.id}
            accessibilityLabel={t('myFarm.openFarm', { name: farm.name })}
            onPress={() => router.push(`/farm/${farm.id}`)}
          >
            <Text>{farm.name}</Text>
          </PressableCard>
        ))
      )}
    </Card>
  );
}
