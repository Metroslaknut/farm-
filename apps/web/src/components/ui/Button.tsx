import type { AnchorHTMLAttributes, ComponentPropsWithRef } from 'react';
import { cx } from './cx';
import { Spinner } from './Spinner';

export type ButtonVariant = 'secondary' | 'primary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface Style {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
}

/** The one place button classes are built — Button and LinkButton share it. */
export const buttonClass = (
  { variant = 'secondary', size = 'md', block }: Style = {},
  extra?: string,
): string =>
  cx(
    'ds-btn',
    variant !== 'secondary' && `ds-btn--${variant}`,
    size !== 'md' && `ds-btn--${size}`,
    block && 'ds-btn--block',
    extra,
  );

export interface ButtonProps extends ComponentPropsWithRef<'button'>, Style {
  /** Shows a spinner and blocks clicks while an action is running. */
  loading?: boolean;
}

export function Button({
  variant,
  size,
  block,
  loading = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={buttonClass({ variant, size, block }, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

/** A link that looks like a button (navigation, not an action). */
export function LinkButton({
  variant,
  size,
  block,
  className,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & Style) {
  return <a {...rest} className={buttonClass({ variant, size, block }, className)} />;
}
