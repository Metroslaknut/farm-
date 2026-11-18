import { Pressable, StyleSheet, View } from 'react-native';
import { useT } from '@/i18n';
import { theme } from '@/theme';
import { Text } from './Text';

export interface Option {
  value: string;
  label: string;
}

/**
 * Single-choice picker shown as wrapping chips (no native <select> on mobile).
 * Exposed to screen readers as a radio group; each chip is a 48pt touch target.
 */
export function OptionPicker({
  label,
  options,
  value,
  onChange,
  error,
  allowEmpty,
  emptyLabel,
}: {
  label: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  /** Adds a first chip that clears the choice. */
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  const t = useT('common');
  const all: Option[] = allowEmpty
    ? [{ value: '', label: emptyLabel ?? t('none') }, ...options]
    : options;
  return (
    <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text variant="label">{label}</Text>
      <View style={styles.chips}>
        {all.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.value || '__empty'}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={`${label}: ${o.label}`}
              onPress={() => onChange(o.value)}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text
                variant="label"
                color={selected ? theme.colors.textOnPrimary : theme.colors.text}
              >
                {selected ? `✓ ${o.label}` : o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <Text variant="caption" color={theme.colors.error.fg}>{`⚠ ${error}`}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: theme.spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  chip: {
    minHeight: theme.minTouch,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    backgroundColor: theme.colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
});
