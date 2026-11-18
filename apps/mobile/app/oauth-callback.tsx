import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { callbackFromParams } from '@/auth/oauth';
import { Button, Screen, StateView } from '@/components/ui';
import { useT } from '@/i18n';

/**
 * Android fallback for social sign-in: the provider's redirect (farmplus://oauth-callback?ticket=…) can reach the router
 * instead of the auth session. If a sign-in is pending on this device, finish it here; otherwise there is nothing to do.
 * The ticket is useless without the verifier held by this app, so a link from elsewhere cannot sign anyone in.
 */
export default function OAuthCallbackScreen() {
  const { completeOAuthRedirect } = useAuth();
  const router = useRouter();
  const t = useT('auth');
  const params = useLocalSearchParams<{ ticket?: string; error?: string }>();
  const [error, setError] = useState<string>();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const leave = () => (router.canGoBack() ? router.back() : router.replace('/sign-in'));
    const callback = callbackFromParams({
      get: (name) => {
        const v = params[name as 'ticket' | 'error'];
        return Array.isArray(v) ? v[0] : v;
      },
    });
    void (async () => {
      const outcome = await completeOAuthRedirect(callback);
      // Nothing pending: the auth session already handled it (or the link did not come from this app).
      if (!outcome || outcome.status === 'cancelled') return leave();
      if (outcome.status === 'authenticated') return router.replace('/');
      if (outcome.status === 'mfa_required')
        return router.replace({ pathname: '/sign-in', params: { mfa: '1' } });
      setError(outcome.message);
    })();
  }, [completeOAuthRedirect, params, router]);

  return (
    <Screen scroll={false}>
      {error ? (
        <>
          <StateView kind="error" error={{ kind: 'unknown', message: error }} />
          <Button title={t('callback.back')} onPress={() => router.replace('/sign-in')} />
        </>
      ) : (
        <StateView kind="loading" label={t('callback.signingIn')} />
      )}
    </Screen>
  );
}
