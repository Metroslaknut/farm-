import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useT } from '../../i18n';
import { Button } from './Button';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Action buttons, right-aligned. */
  footer?: ReactNode;
}

/**
 * Native <dialog>.showModal(): the browser provides the focus trap, inert background, Escape handling and
 * focus return to the opener — more reliable than re-implementing them. We add backdrop-click and a labelled close button.
 */
export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const t = useT('layout');

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="ds-modal"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault(); // we close through state so React stays the source of truth
        onClose();
      }}
      onClick={(event) => {
        // A click on the ::backdrop is dispatched on the dialog itself, outside its box.
        const box = event.currentTarget.getBoundingClientRect();
        const outside =
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom;
        if (event.target === event.currentTarget && outside) onClose();
      }}
    >
      <div className="ds-modal__header">
        <h2 id={titleId} className="ds-modal__title">
          {title}
        </h2>
        <Button variant="ghost" size="sm" aria-label={t('ui.closeDialog')} onClick={onClose}>
          <span aria-hidden="true">✕</span>
        </Button>
      </div>
      {children}
      {footer && <div className="ds-modal__footer">{footer}</div>}
    </dialog>
  );
}
