import { Stack, useRouter } from 'expo-router';
import { Pressable } from 'react-native';
import { Text } from '@/components/ui';
import { useT } from '@/i18n';
import { theme } from '@/theme';

export default function AuthLayout() {
  const router = useRouter();
  const t = useT('tabs');
  const closeLabel = useT('common')('close');
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.background },
        headerTitleStyle: { color: theme.colors.text },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.colors.background },
        headerRight: () => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={closeLabel}
            onPress={close}
            hitSlop={12}
          >
            <Text color={theme.colors.primary} variant="label">
              {closeLabel}
            </Text>
          </Pressable>
        ),
      }}
    >
      <Stack.Screen name="sign-in" options={{ title: t('header.signIn') }} />
      <Stack.Screen name="register" options={{ title: t('header.createAccount') }} />
    </Stack>
  );
}
