import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useT } from '../../i18n';
import { Button } from '../ui/Button';
import { Container } from './Container';

export interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

interface Props {
  brand: ReactNode;
  items: NavItem[];
  /** Right-aligned controls (theme toggle, sign-in, …). */
  actions?: ReactNode;
}

/**
 * Responsive site header. Below 768px the navigation collapses behind a menu button
 * (aria-expanded, Escape closes and returns focus); from 768px up it is a horizontal bar.
 */
export function Header({ brand, items, actions }: Props) {
  const { pathname } = useLocation();
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === pathname; // navigating closes the menu without an effect
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const t = useT('layout');

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenFor(null);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className="ds-header">
      <Container>
        <div className="ds-header__bar">
          <a href="/" className="ds-brand">
            {brand}
          </a>
          <span className="ds-header__spacer" />
          <Button
            ref={buttonRef}
            className="ds-header__menu-btn"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpenFor(open ? null : pathname)}
          >
            {open ? t('basicHeader.closeMenu') : t('basicHeader.menu')}
          </Button>
          <div id={panelId} className="ds-header__panel" data-open={open}>
            <nav aria-label={t('basicHeader.nav')}>
              <ul className="ds-nav__list">
                {items.map((item) => (
                  <li key={item.to}>
                    <NavLink to={item.to} end={item.end} className="ds-nav__link">
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
            {actions}
          </div>
        </div>
      </Container>
    </header>
  );
}
