import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { buttonClass } from './Button';
import { cx } from './cx';

export interface MenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}

interface Props {
  /** Visible text of the trigger button. */
  label: string;
  items: MenuItem[];
  align?: 'start' | 'end';
}

/**
 * Action menu following the WAI-ARIA menu-button pattern: ArrowDown/Up/Home/End move, Enter/Space select,
 * Escape closes and returns focus to the trigger, Tab or an outside click closes.
 */
export function DropdownMenu({ label, items, align = 'start' }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const enabled = items.map((item, index) => (item.disabled ? -1 : index)).filter((i) => i >= 0);

  const focusItem = (index: number) => itemRefs.current[index]?.focus();
  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    focusItem(enabled[0] ?? 0);
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    const position = enabled.indexOf(current);
    const move = (target: number | undefined) => {
      if (target === undefined) return;
      event.preventDefault();
      focusItem(target);
    };
    switch (event.key) {
      case 'ArrowDown':
        return move(enabled[(position + 1) % enabled.length]);
      case 'ArrowUp':
        return move(enabled[(position - 1 + enabled.length) % enabled.length]);
      case 'Home':
        return move(enabled[0]);
      case 'End':
        return move(enabled[enabled.length - 1]);
      case 'Escape':
        event.preventDefault();
        return close(true);
      case 'Tab':
        return close(false);
    }
  };

  return (
    <div className="ds-dropdown" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={buttonClass()}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul
          id={menuId}
          role="menu"
          aria-label={label}
          className={cx('ds-menu', `ds-menu--${align}`)}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, index) => (
            <li key={item.id} role="none">
              <button
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={item.disabled}
                className={cx('ds-menu__item', item.tone === 'danger' && 'ds-menu__item--danger')}
                onClick={() => {
                  close(true);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
