import { Stack } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { OfflineBanner } from '@/components/ui';
import { appConfig } from '@/config/env';
import { initLocale, useLocaleReady, useT } from '@/i18n';
import { NetworkProvider } from '@/network/NetworkProvider';
import { ConfigErrorScreen } from '@/providers/ConfigErrorScreen';
import { theme } from '@/theme';

// Keep the splash visible until we know whether a saved session exists (no flash of "signed out").
void SplashScreen.preventAutoHideAsync();
// The saved language (default Thai) is read while the splash is up, so the first screen is already in it.
void initLocale(SecureStore);

function Navigator() {
  const { status } = useAuth();
  const localeReady = useLocaleReady();
  const t = useT('tabs');
  const back = useT('common')('back');
  const detail = (title: string) => ({ title, headerBackTitle: back });
  useEffect(() => {
    if (status !== 'loading' && localeReady) void SplashScreen.hideAsync();
  }, [status, localeReady]);

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.background },
        headerTintColor: theme.colors.primary,
        headerTitleStyle: { color: theme.colors.text },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false, presentation: 'modal' }} />
      <Stack.Screen
        name="oauth-callback"
        options={{ title: t('header.signingIn'), headerBackVisible: false }}
      />
      <Stack.Screen name="farm/new" options={detail(t('header.newFarm'))} />
      <Stack.Screen name="farm/[id]/index" options={detail(t('header.farm'))} />
      <Stack.Screen name="farm/[id]/animals/index" options={detail(t('header.animals'))} />
      <Stack.Screen name="farm/[id]/animals/new" options={detail(t('header.registerAnimal'))} />
      <Stack.Screen name="animal/[id]" options={detail(t('header.animal'))} />
      <Stack.Screen name="community/index" options={detail(t('header.community'))} />
      <Stack.Screen name="community/new" options={detail(t('header.newPost'))} />
      <Stack.Screen name="community/[id]" options={detail(t('header.post'))} />
      <Stack.Screen name="community/user/[id]" options={detail(t('header.profile'))} />
      <Stack.Screen name="videos/upload" options={detail(t('header.uploadVideo'))} />
      <Stack.Screen name="videos/mine" options={detail(t('header.myVideos'))} />
      <Stack.Screen name="videos/[id]" options={detail(t('header.video'))} />
      <Stack.Screen name="live/index" options={detail(t('header.liveNow'))} />
      <Stack.Screen name="live/[id]" options={detail(t('header.live'))} />
      <Stack.Screen name="marketplace/[id]" options={detail(t('header.listing'))} />
      <Stack.Screen name="orders/index" options={detail(t('header.myOrders'))} />
      <Stack.Screen name="orders/[id]" options={detail(t('header.order'))} />
      <Stack.Screen name="checkout/[negotiationId]" options={detail(t('header.checkout'))} />
      <Stack.Screen name="marketplace/favorites" options={detail(t('header.savedAnimals'))} />
      <Stack.Screen name="marketplace/offers/index" options={detail(t('header.myOffers'))} />
      <Stack.Screen name="marketplace/offers/[id]" options={detail(t('header.negotiation'))} />
      <Stack.Screen name="product/[id]" options={detail(t('header.product'))} />
      <Stack.Screen name="wallet/index" options={detail(t('header.wallet'))} />
      <Stack.Screen name="chat/index" options={detail(t('header.chats'))} />
      <Stack.Screen name="chat/[id]" options={detail(t('header.chat'))} />
      <Stack.Screen name="notifications/index" options={detail(t('header.notifications'))} />
    </Stack>
  );
}

export default function RootLayout() {
  useEffect(() => {
    if (appConfig.configError) void SplashScreen.hideAsync();
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {appConfig.configError ? (
        <ConfigErrorScreen reason={appConfig.configError} />
      ) : (
        <NetworkProvider>
          <AuthProvider>
            <OfflineBanner />
            <Navigator />
          </AuthProvider>
        </NetworkProvider>
      )}
    </SafeAreaProvider>
  );
}
