import type { HTMLAttributes } from 'react';
import { cx } from './cx';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/** Status is always text; the colour only reinforces it. */
export function Badge({
  tone = 'neutral',
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      {...rest}
      className={cx('ds-badge', tone !== 'neutral' && `ds-badge--${tone}`, className)}
    />
  );
}

export function Alert({
  tone = 'info',
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { tone?: Exclude<Tone, 'neutral'> }) {
  return (
    <div
      {...rest}
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx('ds-alert', tone !== 'info' && `ds-alert--${tone}`, className)}
    />
  );
}
