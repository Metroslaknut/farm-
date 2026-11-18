import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { ViewError } from '@/api/errors';
import { useT } from '@/i18n';
import { theme } from '@/theme';
import { Button } from './Button';
import { Text } from './Text';

type Props =
  | { kind: 'loading'; label?: string }
  | { kind: 'empty'; title: string; message?: string }
  | { kind: 'error'; error: ViewError; onRetry?: (() => void) | undefined };

/** One consistent look for loading, empty, error and offline-failure states. */
export function StateView(props: Props) {
  const t = useT('common');
  const te = useT('errors');
  if (props.kind === 'loading') {
    return (
      <View
        style={styles.wrap}
        accessibilityRole="progressbar"
        accessibilityLabel={props.label ?? t('loading')}
      >
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text muted>{props.label ?? t('loadingEllipsis')}</Text>
      </View>
    );
  }
  if (props.kind === 'empty') {
    return (
      <View style={styles.wrap}>
        <Text variant="heading">{props.title}</Text>
        {props.message ? (
          <Text muted style={styles.center}>
            {props.message}
          </Text>
        ) : null}
      </View>
    );
  }
  const offline = props.error.kind === 'offline';
  return (
    <View style={styles.wrap} accessibilityRole="alert">
      <Text variant="heading">{offline ? te('cantConnect') : te('errorTitle')}</Text>
      <Text muted style={styles.center}>
        {props.error.message}
      </Text>
      {props.onRetry ? (
        <Button title={t('tryAgain')} variant="secondary" onPress={props.onRetry} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.xl,
  },
  center: { textAlign: 'center' },
});
