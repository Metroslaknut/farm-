import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cx } from './cx';
import { FormField, type FieldProps } from './FormField';

export function TextField({
  label,
  hint,
  error,
  required,
  id,
  className,
  ...rest
}: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FormField label={label} hint={hint} error={error} required={required} idOverride={id}>
      {(control) => (
        <input {...rest} {...control} required={required} className={cx('ds-input', className)} />
      )}
    </FormField>
  );
}

export function Textarea({
  label,
  hint,
  error,
  required,
  id,
  className,
  ...rest
}: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FormField label={label} hint={hint} error={error} required={required} idOverride={id}>
      {(control) => (
        <textarea
          {...rest}
          {...control}
          required={required}
          className={cx('ds-textarea', className)}
        />
      )}
    </FormField>
  );
}

export function Select({
  label,
  hint,
  error,
  required,
  id,
  className,
  children,
  ...rest
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <FormField label={label} hint={hint} error={error} required={required} idOverride={id}>
      {(control) => (
        <select {...rest} {...control} required={required} className={cx('ds-select', className)}>
          {children}
        </select>
      )}
    </FormField>
  );
}

export function Checkbox({
  label,
  className,
  ...rest
}: { label: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <label className={cx('ds-check', className)}>
      <input {...rest} type="checkbox" />
      <span>{label}</span>
    </label>
  );
}
