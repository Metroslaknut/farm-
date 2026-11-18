import { StyleSheet, View } from 'react-native';
import { useT } from '@/i18n';
import { theme, type StatusTone } from '@/theme';
import { Text } from './Text';

const ICON: Record<StatusTone | 'neutral', string> = {
  success: '✓',
  warning: '!',
  error: '✕',
  neutral: '•',
};

/** Clear states for success / warning / error: colour + icon + text, never colour alone. */
export function StatusBadge({ tone, label }: { tone: StatusTone | 'neutral'; label: string }) {
  const t = useT('common');
  const c =
    tone === 'neutral'
      ? { fg: theme.colors.text, bg: theme.colors.surfaceAlt }
      : theme.colors[tone];
  return (
    <View
      style={[styles.badge, { backgroundColor: c.bg }]}
      accessible
      accessibilityLabel={`${t(`tone.${tone}`)}: ${label}`}
    >
      <Text variant="caption" color={c.fg} style={styles.icon}>
        {ICON[tone]}
      </Text>
      <Text variant="label" color={c.fg}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius.pill,
  },
  icon: { fontWeight: theme.font.weight.bold },
});
