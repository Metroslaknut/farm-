import { LOCALES, type Locale } from '@farmplus/i18n';
import { useLocale } from '../../i18n';

const LABEL: Record<Locale, { short: string; name: string }> = {
  th: { short: 'TH', name: 'ภาษาไทย' },
  en: { short: 'EN', name: 'English' },
};

/** TH | EN switch (radio group like the theme toggle). Each option is named in its own language. */
export function LanguageToggle({ className }: { className?: string }) {
  const [locale, setLocale] = useLocale();
  return (
    <fieldset className={`ds-theme-toggle ds-lang-toggle${className ? ` ${className}` : ''}`}>
      <legend className="ds-sr-only">ภาษา / Language</legend>
      {LOCALES.map((value) => (
        <label key={value} lang={value} title={LABEL[value].name}>
          <input
            type="radio"
            name="ds-lang"
            value={value}
            checked={locale === value}
            onChange={() => setLocale(value)}
            aria-label={LABEL[value].name}
          />
          {LABEL[value].short}
        </label>
      ))}
    </fieldset>
  );
}
