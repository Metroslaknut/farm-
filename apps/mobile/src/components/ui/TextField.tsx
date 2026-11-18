import { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { useT } from '@/i18n';
import { theme } from '@/theme';
import { Text } from './Text';

export interface TextFieldProps extends TextInputProps {
  label: string;
  error?: string | undefined;
  hint?: string;
}

/**
 * Labelled input: the label is also the accessibility label; errors are announced with the field.
 * A password field (`secureTextEntry`) gets a Show/Hide button; it always starts hidden.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, hint, style, secureTextEntry, ...rest },
  ref,
) {
  const t = useT('common');
  const [shown, setShown] = useState(false);
  const input = (
    <TextInput
      ref={ref}
      accessibilityLabel={label}
      accessibilityHint={error ?? hint}
      placeholderTextColor={theme.colors.textMuted}
      {...rest}
      secureTextEntry={secureTextEntry ? !shown : false}
      style={[
        styles.input,
        secureTextEntry ? styles.inputWithToggle : null,
        error ? styles.inputError : null,
        style,
      ]}
    />
  );
  return (
    <View style={styles.wrap}>
      <Text variant="label">{label}</Text>
      {secureTextEntry ? (
        <View style={styles.row}>
          {input}
          <Pressable
            onPress={() => setShown((s) => !s)}
            accessibilityRole="button"
            accessibilityLabel={t('password.showLabel')}
            accessibilityState={{ checked: shown }}
            hitSlop={8}
            style={styles.toggle}
          >
            <Text variant="label" color={theme.colors.primary}>
              {shown ? t('password.hide') : t('password.show')}
            </Text>
          </Pressable>
        </View>
      ) : (
        input
      )}
      {error ? (
        <Text variant="caption" color={theme.colors.error.fg} accessibilityLiveRegion="polite">
          {`⚠ ${error}`}
        </Text>
      ) : hint ? (
        <Text variant="caption" muted>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: theme.spacing.xs },
  input: {
    minHeight: theme.minTouch,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    backgroundColor: theme.colors.background,
    color: theme.colors.text,
    fontSize: theme.font.size.md,
  },
  inputError: { borderColor: theme.colors.error.fg, borderWidth: 2 },
  row: { justifyContent: 'center' },
  inputWithToggle: { paddingRight: 64 },
  toggle: {
    position: 'absolute',
    right: theme.spacing.sm,
    minHeight: theme.minTouch,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.sm,
  },
});
