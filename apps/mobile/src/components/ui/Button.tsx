import { ActivityIndicator, Pressable, StyleSheet, type PressableProps } from 'react-native';
import { theme } from '@/theme';
import { Text } from './Text';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  title: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
  /** Spoken label if it should differ from the visible title. */
  accessibilityLabel?: string;
}

export function Button({
  title,
  variant = 'primary',
  loading = false,
  disabled,
  onPress,
  ...rest
}: ButtonProps) {
  const inactive = disabled || loading;
  return (
    <Pressable
      {...rest}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && {
          backgroundColor: pressed ? theme.colors.primaryPressed : theme.colors.primary,
        },
        variant === 'secondary' && {
          backgroundColor: pressed ? theme.colors.surfaceAlt : theme.colors.background,
          borderWidth: 1,
          borderColor: theme.colors.borderStrong,
        },
        variant === 'ghost' && {
          backgroundColor: pressed ? theme.colors.primarySoft : 'transparent',
        },
        inactive && styles.inactive,
      ]}
    >
      {loading && (
        <ActivityIndicator
          color={variant === 'primary' ? theme.colors.textOnPrimary : theme.colors.primary}
        />
      )}
      <Text
        variant="label"
        color={variant === 'primary' ? theme.colors.textOnPrimary : theme.colors.primary}
        style={styles.title}
      >
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: theme.minTouch,
    paddingHorizontal: theme.spacing.xl,
    borderRadius: theme.radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
  },
  title: { fontSize: theme.font.size.md, fontWeight: theme.font.weight.bold },
  inactive: { opacity: 0.55 },
});
