import type { HTMLAttributes } from 'react';
import { cx } from '../ui/cx';

export function Container({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cx('ds-container', className)} />;
}
