import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { buttonClass, type ButtonProps } from '../../components/ui';

/** Router link styled as a button: client-side navigation (no page reload), same classes as <Button>. */
export function NavButton({
  to,
  variant,
  size,
  children,
}: {
  to: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  children: ReactNode;
}) {
  return (
    <Link to={to} className={buttonClass({ variant, size })}>
      {children}
    </Link>
  );
}
