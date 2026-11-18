import type { Locale } from '@farmplus/i18n';
import { Pressable, StyleSheet, View } from 'react-native';
import { useLocale, useT } from '@/i18n';
import { theme } from '@/theme';
import { Text } from './Text';

const CHOICES: { locale: Locale; short: string; key: 'language.th' | 'language.en' }[] = [
  { locale: 'th', short: 'TH', key: 'language.th' },
  { locale: 'en', short: 'EN', key: 'language.en' },
];

/**
 * TH / EN switch. A radio group for screen readers (each option announces its language name and whether it is
 * selected); each option is a 48pt touch target. The choice is applied at once and remembered on the device.
 */
export function LanguageSwitch() {
  const [locale, setLocale] = useLocale();
  const t = useT('common');
  return (
    <View style={styles.row}>
      <Text variant="label" muted>
        {t('language.label')}
      </Text>
      <View
        style={styles.group}
        accessibilityRole="radiogroup"
        accessibilityLabel={t('language.label')}
      >
        {CHOICES.map((c) => {
          const selected = c.locale === locale;
          return (
            <Pressable
              key={c.locale}
              accessibilityRole="radio"
              accessibilityLabel={t(c.key)}
              accessibilityState={{ checked: selected, selected }}
              accessibilityLanguage={c.locale}
              onPress={() => setLocale(c.locale)}
              testID={`language-${c.locale}`}
              style={[styles.option, selected && styles.selected]}
            >
              <Text
                variant="label"
                color={selected ? theme.colors.textOnPrimary : theme.colors.text}
              >
                {c.short}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  group: {
    flexDirection: 'row',
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    overflow: 'hidden',
  },
  option: {
    minHeight: theme.minTouch,
    minWidth: theme.minTouch + theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
  },
  selected: { backgroundColor: theme.colors.primary },
});
