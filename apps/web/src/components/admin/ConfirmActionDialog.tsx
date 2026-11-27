import { useEffect, useRef, useState, type ReactNode } from 'react';
import { errorMessage } from '../../lib/format';
import { rich, useAdminI18n } from './i18n';

interface Props {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  tone?: 'default' | 'danger';
  /** Sensitive actions record a reason in the audit log (the API requires 3+ characters). */
  requireReason?: boolean;
  /**
   * The API's own schema for the reason (e.g. `productReasonSchema`): checked before sending, its message shown
   * under the field in the admin's language. Without it, a reason only needs 3+ characters.
   */
  reasonSchema?: {
    safeParse: (
      value: unknown,
    ) => { success: true } | { success: false; error: { issues: { message: string }[] } };
  };
  /** Money-moving actions: the person must type this exact reference (e.g. the refund number) before the button works. */
  confirmText?: string;
  onConfirm: (reason: string, typed: string) => Promise<unknown>;
  onClose: () => void;
}

/** Native <dialog>: focus trapping, Escape-to-close and inert background come from the browser. */
export function ConfirmActionDialog({
  open,
  title,
  description,
  confirmLabel,
  tone = 'default',
  requireReason = false,
  confirmText,
  reasonSchema,
  onConfirm,
  onClose,
}: Props) {
  const { t, validation } = useAdminI18n();
  const [reasonError, setReasonError] = useState<string>();
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setReason('');
      setTyped('');
      setError(undefined);
      setReasonError(undefined);
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);

  const reasonTooShort =
    (requireReason && reason.trim().length < 3) ||
    (confirmText !== undefined && typed.trim() !== confirmText);

  const confirm = async () => {
    if (requireReason && reasonSchema) {
      const checked = reasonSchema.safeParse({ reason: reason.trim() });
      if (!checked.success) {
        setReasonError(validation(checked.error.issues[0]?.message ?? ''));
        return;
      }
    }
    setReasonError(undefined);
    setBusy(true);
    setError(undefined);
    try {
      await onConfirm(reason.trim(), typed.trim());
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={ref}
      className="adm-dialog"
      aria-labelledby="adm-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (!reasonTooShort && !busy) void confirm();
        }}
      >
        <h2 id="adm-dialog-title">{title}</h2>
        {description && <div className="adm-dialog__body">{description}</div>}
        {requireReason && (
          <label className="adm-field">
            <span>{t('confirm.reason')}</span>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              required
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={reasonError ? 'adm-dialog-reason-error' : undefined}
            />
            {reasonError && (
              <span id="adm-dialog-reason-error" className="adm-error" role="alert">
                {reasonError}
              </span>
            )}
          </label>
        )}
        {confirmText !== undefined && (
          <label className="adm-field">
            <span>{rich(t('confirm.type'), { code: <strong>{confirmText}</strong> })}</span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>
        )}
        {error && (
          <p className="adm-error" role="alert">
            {error}
          </p>
        )}
        <div className="adm-dialog__actions">
          <button type="button" className="adm-btn" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className={`adm-btn ${tone === 'danger' ? 'adm-btn--danger' : 'adm-btn--primary'}`}
            disabled={reasonTooShort || busy}
          >
            {busy ? t('common.working') : confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
