import type { ReactNode } from 'react';
import { useAdminI18n } from './i18n';
import { StateMessage } from './StateMessage';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** When set the column header sorts by this server-side field. */
  sortKey?: string;
}

export interface SortState {
  by: string;
  order: 'asc' | 'desc';
}

interface Props<T> {
  caption: string;
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  loading: boolean;
  error?: string | undefined;
  onRetry?: () => void;
  emptyMessage?: string;
}

export function AdminDataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  total,
  page,
  pageSize,
  onPageChange,
  sort,
  onSortChange,
  loading,
  error,
  onRetry,
  emptyMessage,
}: Props<T>) {
  const { t } = useAdminI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  if (error && !rows)
    return (
      <StateMessage kind="error" onRetry={onRetry}>
        {error}
      </StateMessage>
    );
  if (loading && !rows) return <StateMessage kind="loading" />;

  return (
    <div className="adm-table-wrap" aria-busy={loading}>
      {error && (
        <StateMessage kind="error" onRetry={onRetry}>
          {error}
        </StateMessage>
      )}
      {rows && rows.length === 0 ? (
        <StateMessage kind="empty">{emptyMessage ?? t('table.noResults')}</StateMessage>
      ) : (
        <div className="adm-table-scroll">
          <table className="adm-table">
            <caption className="adm-sr-only">{caption}</caption>
            <thead>
              <tr>
                {columns.map((c) => {
                  const active = sort && c.sortKey === sort.by;
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={
                        active ? (sort.order === 'asc' ? 'ascending' : 'descending') : undefined
                      }
                    >
                      {c.sortKey && onSortChange ? (
                        <button
                          type="button"
                          className="adm-sort"
                          onClick={() =>
                            onSortChange({
                              by: c.sortKey!,
                              order: active && sort.order === 'asc' ? 'desc' : 'asc',
                            })
                          }
                        >
                          {c.header}
                          <span aria-hidden="true">
                            {active ? (sort.order === 'asc' ? ' ▲' : ' ▼') : ''}
                          </span>
                        </button>
                      ) : (
                        c.header
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows?.map((row) => (
                <tr key={rowKey(row)}>
                  {columns.map((c) => (
                    <td key={c.key} data-label={c.header}>
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <nav className="adm-pager" aria-label={t('table.pagination')}>
        <span>{t('table.range', { from, to, total })}</span>
        <button
          type="button"
          className="adm-btn"
          disabled={page <= 1 || loading}
          onClick={() => onPageChange(page - 1)}
        >
          {t('common.previous')}
        </button>
        <span aria-live="polite">{t('table.page', { page, pages })}</span>
        <button
          type="button"
          className="adm-btn"
          disabled={page >= pages || loading}
          onClick={() => onPageChange(page + 1)}
        >
          {t('common.next')}
        </button>
      </nav>
    </div>
  );
}
