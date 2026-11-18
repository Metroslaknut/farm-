import { useTheme } from '../../hooks/useTheme';
import { useT } from '../../i18n';
import { THEME_PREFERENCES, type ThemePreference } from '../../themes';

const LABEL = {
  light: 'theme.light',
  dark: 'theme.dark',
  system: 'theme.system',
} as const satisfies Record<ThemePreference, string>;

/** Segmented radio group: native radios give arrow-key navigation and screen-reader semantics for free. */
export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const t = useT('layout');
  return (
    <fieldset className="ds-theme-toggle">
      <legend className="ds-sr-only">{t('theme.legend')}</legend>
      {THEME_PREFERENCES.map((value) => (
        <label key={value}>
          <input
            type="radio"
            name="ds-theme"
            value={value}
            checked={preference === value}
            onChange={() => setPreference(value)}
          />
          {t(LABEL[value])}
        </label>
      ))}
    </fieldset>
  );
}
