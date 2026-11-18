import { useId, type ReactNode } from 'react';

export interface FieldProps {
  label: string;
  hint?: string;
  /** Validation message. Sets aria-invalid on the control and is announced with it. */
  error?: string | undefined;
  required?: boolean | undefined;
}

export interface ControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
  'aria-required': true | undefined;
}

/**
 * Label + hint + error wiring shared by every form control (TextField, Select, Textarea): one
 * implementation of the accessible-name / description / invalid relationships.
 */
export function FormField({
  label,
  hint,
  error,
  required,
  idOverride,
  children,
}: FieldProps & {
  idOverride?: string | undefined;
  children: (control: ControlProps) => ReactNode;
}) {
  const generated = useId();
  const id = idOverride ?? generated;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="ds-field">
      <label className="ds-field__label" htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        'aria-required': required ? true : undefined,
      })}
      {hint && (
        <span id={hintId} className="ds-field__hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="ds-field__error">
          {error}
        </span>
      )}
    </div>
  );
}
