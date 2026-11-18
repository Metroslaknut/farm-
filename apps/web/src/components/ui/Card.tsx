import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  /** Heading level for the title so the page outline stays correct. */
  headingLevel?: 1 | 2 | 3 | 4;
  footer?: ReactNode;
  flat?: boolean;
}

export function Card({
  title,
  headingLevel = 3,
  footer,
  flat,
  className,
  children,
  ...rest
}: CardProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <section {...rest} className={cx('ds-card', flat && 'ds-card--flat', className)}>
      {title && <Heading className="ds-card__title">{title}</Heading>}
      {children}
      {footer && <div className="ds-card__footer">{footer}</div>}
    </section>
  );
}
