import { useState, type InputHTMLAttributes } from 'react';
import { useT } from '../../i18n';
import { Icon } from '../layout/Icon';
import { cx } from './cx';
import { FormField, type FieldProps } from './FormField';
import './password.css';

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/**
 * Password input with a show/hide button. The button has one fixed name and reports its state with aria-pressed,
 * so screen readers hear "แสดงรหัสผ่าน, pressed / not pressed" (English: "Show, pressed"). The English name avoids
 * the word "password" so a label search for "Password" finds only the field. The field always starts hidden.
 */
export function PasswordInput({ className, ...rest }: InputProps) {
  const [shown, setShown] = useState(false);
  const t = useT('layout');
  return (
    <span className="ds-password">
      <input {...rest} type={shown ? 'text' : 'password'} className={className} />
      <button
        type="button"
        className="ds-password__toggle"
        aria-label={t('ui.showPassword')}
        aria-pressed={shown}
        aria-controls={rest.id}
        title={shown ? t('ui.hidePassword') : t('ui.showPassword')}
        onClick={() => setShown((s) => !s)}
      >
        <Icon name={shown ? 'eyeOff' : 'eye'} size={18} />
      </button>
    </span>
  );
}

/** `TextField` for passwords: label, hint and error like every other field, plus the show/hide button. */
export function PasswordField({
  label,
  hint,
  error,
  required,
  id,
  className,
  ...rest
}: FieldProps & InputProps) {
  return (
    <FormField label={label} hint={hint} error={error} required={required} idOverride={id}>
      {(control) => (
        <PasswordInput
          {...rest}
          {...control}
          required={required}
          className={cx('ds-input', className)}
        />
      )}
    </FormField>
  );
}
