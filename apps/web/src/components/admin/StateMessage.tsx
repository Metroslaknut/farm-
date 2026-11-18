import type { ReactNode } from 'react';
import { useAdminI18n } from './i18n';

export function StateMessage({
  kind,
  children,
  onRetry,
}: {
  kind: 'loading' | 'empty' | 'error';
  children?: ReactNode;
  onRetry?: (() => void) | undefined;
}) {
  const { t } = useAdminI18n();
  const text =
    children ??
    (kind === 'loading'
      ? t('common.loading')
      : kind === 'empty'
        ? t('common.empty')
        : t('common.error'));
  return (
    <div className={`adm-state adm-state--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <p>{text}</p>
      {kind === 'error' && onRetry && (
        <button type="button" className="adm-btn" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}
