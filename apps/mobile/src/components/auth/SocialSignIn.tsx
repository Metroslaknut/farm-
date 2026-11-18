import type { OAuthProviderId } from '@farmplus/api-client';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { publicApi } from '@/api/public';
import { useAuth } from '@/auth/AuthProvider';
import { supportedProviders } from '@/auth/oauth';
import { Text } from '@/components/ui';
import { useT } from '@/i18n';
import { theme } from '@/theme';

const LABEL = {
  google: 'social.google',
  facebook: 'social.facebook',
} as const satisfies Record<OAuthProviderId, string>;

/**
 * "or" divider + one button per provider the API has configured (none → renders nothing, so the screen looks exactly
 * as before). Outcomes go back to the screen; errors are shown here.
 */
export function SocialSignIn({
  onAuthenticated,
  onMfaRequired,
  disabled,
}: {
  onAuthenticated(): void;
  onMfaRequired(): void;
  disabled?: boolean;
}) {
  const { signInWithProvider } = useAuth();
  const t = useT('auth');
  const [providers, setProviders] = useState<OAuthProviderId[]>([]);
  const [busy, setBusy] = useState<OAuthProviderId | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const ctrl = new AbortController();
    publicApi
      .oauthProviders(ctrl.signal)
      .then((list) => setProviders(supportedProviders(list)))
      .catch(() => setProviders([])); // offline / not configured: password sign-in only
    return () => ctrl.abort();
  }, []);

  if (providers.length === 0) return null;

  const start = async (provider: OAuthProviderId) => {
    setBusy(provider);
    setError(undefined);
    try {
      const outcome = await signInWithProvider(provider);
      if (outcome.status === 'authenticated') onAuthenticated();
      else if (outcome.status === 'mfa_required') onMfaRequired();
      else if (outcome.status === 'error') setError(outcome.message);
    } catch {
      setError(t('oauth.generic'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.divider} accessible={false}>
        <View style={styles.line} />
        <Text variant="label" muted>
          {t('social.or')}
        </Text>
        <View style={styles.line} />
      </View>
      {providers.map((p) => {
        const facebook = p === 'facebook';
        const inactive = disabled || busy !== null;
        return (
          <Pressable
            key={p}
            accessibilityRole="button"
            accessibilityLabel={t(LABEL[p])}
            accessibilityState={{ disabled: inactive, busy: busy === p }}
            disabled={inactive}
            onPress={() => void start(p)}
            style={({ pressed }) => [
              styles.button,
              facebook
                ? {
                    backgroundColor: pressed
                      ? theme.colors.social.facebookPressed
                      : theme.colors.social.facebook,
                  }
                : {
                    backgroundColor: pressed ? theme.colors.surfaceAlt : theme.colors.background,
                    borderWidth: 1,
                    borderColor: theme.colors.borderStrong,
                  },
              inactive && styles.inactive,
            ]}
          >
            {busy === p ? (
              <ActivityIndicator
                color={facebook ? theme.colors.social.onFacebook : theme.colors.primary}
              />
            ) : (
              <Text
                style={styles.mark}
                color={facebook ? theme.colors.social.onFacebook : theme.colors.social.googleMark}
                importantForAccessibility="no"
              >
                {facebook ? 'f' : 'G'}
              </Text>
            )}
            <Text
              variant="label"
              style={styles.title}
              color={facebook ? theme.colors.social.onFacebook : theme.colors.text}
            >
              {t(LABEL[p])}
            </Text>
          </Pressable>
        );
      })}
      {error ? (
        <Text
          variant="caption"
          color={theme.colors.error.fg}
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
        >
          {`⚠ ${error}`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: theme.spacing.md },
  divider: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border },
  button: {
    minHeight: theme.minTouch,
    paddingHorizontal: theme.spacing.xl,
    borderRadius: theme.radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
  },
  mark: { fontSize: theme.font.size.lg, fontWeight: theme.font.weight.bold, lineHeight: 22 },
  title: { fontSize: theme.font.size.md, fontWeight: theme.font.weight.bold },
  inactive: { opacity: 0.55 },
});
