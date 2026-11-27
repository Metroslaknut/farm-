import type { MouseEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { buttonClass, type ButtonProps } from '../../components/ui';

/** Router link styled as a button: client-side navigation (no page reload), same classes as <Button>. */
export function NavButton({
  to,
  variant,
  size,
  children,
  'data-tour': dataTour,
  onOpen,
}: {
  to: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  children: ReactNode;
  /** Guided-tour anchor (see src/tours). */
  'data-tour'?: string;
  /**
   * Opens something on this page instead (e.g. a form in a dialog) on a plain click. The link still works when opened
   * in a new tab or window (Ctrl/⌘/Shift/middle click), and its page stays reachable by its URL.
   */
  onOpen?: () => void;
}) {
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!onOpen || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onOpen();
  };
  return (
    <Link to={to} className={buttonClass({ variant, size })} data-tour={dataTour} onClick={click}>
      {children}
    </Link>
  );
}
