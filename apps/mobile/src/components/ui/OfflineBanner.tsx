import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNetwork } from '@/network/NetworkProvider';
import { useT } from '@/i18n';
import { theme } from '@/theme';
import { Text } from './Text';

/** Slim banner shown app-wide while the device has no connection. */
export function OfflineBanner() {
  const { isOnline } = useNetwork();
  const insets = useSafeAreaInsets();
  const t = useT('common');
  if (isOnline) return null;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.bar, { paddingTop: insets.top + theme.spacing.xs }]}
    >
      <Text variant="label" color={theme.colors.warning.fg}>
        {t('offline')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: theme.colors.warning.bg,
    paddingBottom: theme.spacing.xs,
    paddingHorizontal: theme.spacing.lg,
    alignItems: 'center',
  },
});
