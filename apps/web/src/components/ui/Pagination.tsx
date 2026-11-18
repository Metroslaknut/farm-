import { useT } from '../../i18n';
import { Button } from './Button';

interface Props {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  loading?: boolean;
}

/** Previous/next with a "21–40 of 45" summary. Reused by every paged list. */
export function Pagination({ page, pageSize, total, onPageChange, loading }: Props) {
  const t = useT('layout');
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav
      aria-label={t('ui.pagination')}
      className="ds-row"
      style={{ justifyContent: 'space-between', marginTop: 'var(--ds-space-3)' }}
    >
      <span>{t('ui.paginationRange', { from, to, total })}</span>
      <span className="ds-row">
        <Button size="sm" disabled={page <= 1 || loading} onClick={() => onPageChange(page - 1)}>
          {t('ui.previous')}
        </Button>
        <span aria-live="polite">{t('ui.pageOf', { page, pages })}</span>
        <Button
          size="sm"
          disabled={page >= pages || loading}
          onClick={() => onPageChange(page + 1)}
        >
          {t('ui.next')}
        </Button>
      </span>
    </nav>
  );
}
