import type { ReactNode } from 'react';
import { useT } from '../../i18n';

export interface TableColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Enables a sort button on this column. */
  sortKey?: string;
}

export interface TableSort {
  by: string;
  order: 'asc' | 'desc';
}

interface Props<T> {
  /** Required: names the table for assistive tech and doubles as a visible title. */
  caption: string;
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  sort?: TableSort | undefined;
  onSortChange?: ((sort: TableSort) => void) | undefined;
  emptyMessage?: string;
}

/** Presentational data table. Scrolls horizontally inside a focusable region on narrow screens. */
export function Table<T>({
  caption,
  columns,
  rows,
  rowKey,
  sort,
  onSortChange,
  emptyMessage,
}: Props<T>) {
  const t = useT('layout');
  return (
    <div
      className="ds-table-wrap"
      role="region"
      aria-label={t('ui.tableScrollable', { caption })}
      tabIndex={0}
    >
      <table className="ds-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sort !== undefined && column.sortKey === sort.by;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    active ? (sort.order === 'asc' ? 'ascending' : 'descending') : undefined
                  }
                >
                  {column.sortKey && onSortChange ? (
                    <button
                      type="button"
                      className="ds-table__sort"
                      onClick={() =>
                        onSortChange({
                          by: column.sortKey!,
                          order: active && sort.order === 'asc' ? 'desc' : 'asc',
                        })
                      }
                    >
                      {column.header}
                      <span aria-hidden="true">
                        {active ? (sort.order === 'asc' ? ' ▲' : ' ▼') : ''}
                      </span>
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>{emptyMessage ?? t('ui.tableEmpty')}</td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column) => (
                  <td key={column.key}>{column.cell(row)}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
