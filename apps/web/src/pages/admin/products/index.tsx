import { useState } from 'react';
import {
  PRODUCT_STATUSES,
  type Page,
  type ProductCategoryDTO,
  type ProductDTO,
  type ProductStatus,
} from '@farmplus/shared-types';
import { formatBaht } from '@farmplus/shared-utils';
import { cap, rich, useAdminI18n, type AdminKey } from '../../../components/admin/i18n';
import { api } from '../../../api';
import { ConfirmActionDialog, StateMessage } from '../../../components/admin';
import { errorMessage } from '../../../lib/format';
import { useAsync } from '../../../lib/useAsync';

type Action = 'approve' | 'reject' | 'suspend' | 'restore';
const COPY: Record<
  Action,
  { title: AdminKey; confirm: AdminKey; danger: boolean; reason: boolean; text: AdminKey }
> = {
  approve: {
    title: 'productAction.approve.title',
    confirm: 'action.approve',
    danger: false,
    reason: false,
    text: 'productAction.approve.text',
  },
  reject: {
    title: 'productAction.reject.title',
    confirm: 'action.reject',
    danger: true,
    reason: true,
    text: 'productAction.reject.text',
  },
  suspend: {
    title: 'productAction.suspend.title',
    confirm: 'action.suspend',
    danger: true,
    reason: true,
    text: 'productAction.suspend.text',
  },
  restore: {
    title: 'productAction.restore.title',
    confirm: 'action.restore',
    danger: false,
    reason: false,
    text: 'productAction.restore.text',
  },
};
const ACTIONS: Partial<Record<ProductStatus, Action[]>> = {
  PENDING_REVIEW: ['approve', 'reject'],
  ACTIVE: ['suspend'],
  PAUSED: ['suspend'],
  SUSPENDED: ['restore'],
};

/** `/admin/products` — product moderation queue and the category compliance switches. */
export default function ProductsPage() {
  const { t } = useAdminI18n();
  return (
    <>
      <h1>{t('nav.products')}</h1>
      <Queue />
      <Categories />
    </>
  );
}

function Queue() {
  const { t, status: statusLabel, dateTime } = useAdminI18n();
  const [status, setStatus] = useState<ProductStatus>('PENDING_REVIEW');
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const list = useAsync(
    (signal) =>
      api.request<Page<ProductDTO>>('GET', '/shop/moderation/products', {
        signal,
        query: { status, page, pageSize: 10 },
      }),
    [status, page, version],
  );
  const [pending, setPending] = useState<{ product: ProductDTO; action: Action } | null>(null);
  const [scan, setScan] = useState<string>();

  const act = async (reason: string) => {
    if (!pending) return;
    await api.request('POST', `/shop/moderation/products/${pending.product.id}/${pending.action}`, {
      body: COPY[pending.action].reason ? { reason } : {},
    });
    setVersion((v) => v + 1);
  };
  const rescan = async () => {
    setScan(t('common.running'));
    try {
      const r = await api.request<{
        checked: number;
        suspended: { id: string; title: string; reason: string }[];
      }>('POST', '/shop/moderation/rescan', { body: {} });
      setScan(
        t('products.scanDone', {
          checked: r.checked,
          count: r.suspended.length,
          list: r.suspended.map((s) => ` ${s.title} (${s.reason})`).join(''),
        }),
      );
      setVersion((v) => v + 1);
    } catch (e) {
      setScan(errorMessage(e));
    }
  };
  const d = list.data;

  return (
    <section aria-label={t('products.queue')}>
      <h2>{t('products.moderation')}</h2>
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'end', flexWrap: 'wrap' }}>
        <label className="adm-field" style={{ maxWidth: '16rem' }}>
          <span>{t('common.status')}</span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as ProductStatus);
              setPage(1);
            }}
          >
            {PRODUCT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {cap(statusLabel(s))}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="adm-btn" onClick={() => void rescan()}>
          {t('products.rescan')}
        </button>
        {scan && <span role="status">{scan}</span>}
      </div>
      {list.error && <StateMessage kind="error">{list.error}</StateMessage>}
      {list.loading && !d && <StateMessage kind="loading" />}
      {d && d.items.length === 0 && (
        <StateMessage kind="empty">
          {t('products.empty', { status: cap(statusLabel(status)) })}
        </StateMessage>
      )}
      {d?.items.map((p) => (
        <article key={p.id} className="adm-card" aria-label={p.title}>
          <h3 style={{ marginTop: 0 }}>
            {p.title} <small>{formatBaht(p.priceMinor)}</small>
          </h3>
          <dl className="adm-dl">
            <dt>{t('users.seller')}</dt>
            <dd>
              {p.seller.displayName} · {p.farmName}
            </dd>
            <dt>{t('products.category')}</dt>
            <dd>{p.categoryName}</dd>
            {p.brand && (
              <>
                <dt>{t('products.brand')}</dt>
                <dd>{p.brand}</dd>
              </>
            )}
            {p.regulatory && (
              <>
                <dt>{t('products.regNo')}</dt>
                <dd>{p.regulatory.registrationNumber}</dd>
              </>
            )}
            {p.description && (
              <>
                <dt>{t('common.description')}</dt>
                <dd style={{ whiteSpace: 'pre-wrap' }}>{p.description}</dd>
              </>
            )}
            {p.specs.length > 0 && (
              <>
                <dt>{t('products.specs')}</dt>
                <dd>{p.specs.map((s) => `${s.name}: ${s.value}`).join(' · ')}</dd>
              </>
            )}
            <dt>{t('common.photos')}</dt>
            <dd>
              {p.photos.length === 0
                ? '—'
                : p.photos.map((x) => (
                    <a
                      key={x.url}
                      href={x.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ marginRight: '0.75rem' }}
                    >
                      {t('common.photo')}
                    </a>
                  ))}
            </dd>
            {p.review?.rejectedReason && (
              <>
                <dt>{t('common.rejected')}</dt>
                <dd>{p.review.rejectedReason}</dd>
              </>
            )}
            {p.review?.suspendedReason && (
              <>
                <dt>{t('products.suspended')}</dt>
                <dd>{p.review.suspendedReason}</dd>
              </>
            )}
            <dt>{t('products.updated')}</dt>
            <dd>{dateTime(p.updatedAt)}</dd>
          </dl>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {(ACTIONS[p.status] ?? []).map((a) => (
              <button
                key={a}
                type="button"
                className={`adm-btn ${COPY[a].danger ? 'adm-btn--danger' : 'adm-btn--primary'}`}
                onClick={() => setPending({ product: p, action: a })}
              >
                {t(COPY[a].confirm)}
              </button>
            ))}
          </div>
        </article>
      ))}
      {d && d.total > d.pageSize && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button
            type="button"
            className="adm-btn"
            disabled={page <= 1}
            onClick={() => setPage((x) => x - 1)}
          >
            {t('common.previous')}
          </button>
          <span>{t('products.page', { page, pages: Math.ceil(d.total / d.pageSize) })}</span>
          <button
            type="button"
            className="adm-btn"
            disabled={page >= Math.ceil(d.total / d.pageSize)}
            onClick={() => setPage((x) => x + 1)}
          >
            {t('common.next')}
          </button>
        </div>
      )}
      <ConfirmActionDialog
        open={pending !== null}
        title={pending ? t(COPY[pending.action].title) : ''}
        description={pending ? <p>{t(COPY[pending.action].text)}</p> : null}
        confirmLabel={pending ? t(COPY[pending.action].confirm) : ''}
        tone={pending && COPY[pending.action].danger ? 'danger' : 'default'}
        requireReason={pending ? COPY[pending.action].reason : false}
        onConfirm={act}
        onClose={() => setPending(null)}
      />
    </section>
  );
}

function Categories() {
  const { t, label, dateTime } = useAdminI18n();
  const [version, setVersion] = useState(0);
  const cats = useAsync(
    (signal) =>
      api.request<{ categories: ProductCategoryDTO[] }>('GET', '/shop/categories', { signal }),
    [version],
  );
  const [pending, setPending] = useState<{ cat: ProductCategoryDTO; enable: boolean } | null>(null);
  const [reference, setReference] = useState('');

  const act = async (reason: string, typed: string) => {
    if (!pending) return;
    await api.request('POST', `/shop/admin/categories/${pending.cat.key}/sales`, {
      body: {
        enabled: pending.enable,
        reason,
        confirmation: typed,
        ...(pending.enable && reference.trim() ? { complianceReference: reference.trim() } : {}),
      },
    });
    setReference('');
    setVersion((v) => v + 1);
  };

  return (
    <section aria-label={t('categories.aria')} style={{ marginTop: '2rem' }}>
      <h2>{t('categories.title')}</h2>
      <p className="adm-muted">
        {rich(t('categories.intro'), {
          perm: <code>settings.manage</code>,
          prohibited: <code>products.prohibitedTerms</code>,
          claims: <code>products.claimTerms</code>,
        })}
      </p>
      {cats.error && <StateMessage kind="error">{cats.error}</StateMessage>}
      <div className="adm-table-scroll">
        <table className="adm-table" aria-label={t('categories.table')}>
          <thead>
            <tr>
              <th scope="col">{t('products.category')}</th>
              <th scope="col">{t('categories.regulation')}</th>
              <th scope="col">{t('categories.sales')}</th>
              <th scope="col">{t('categories.review')}</th>
              <th scope="col">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {cats.data?.categories.map((c) => (
              <tr key={c.key}>
                <td>
                  {c.name} <small>({c.key})</small>
                </td>
                <td>{cap(label('regulation', c.regulation))}</td>
                <td>
                  <span
                    className={`adm-badge adm-badge--${c.salesEnabled ? 'success' : 'neutral'}`}
                  >
                    {c.salesEnabled ? t('categories.open') : t('categories.closed')}
                  </span>
                </td>
                <td>
                  {c.complianceReference
                    ? `${c.complianceReference} · ${dateTime(c.complianceReviewedAt)}`
                    : '—'}
                </td>
                <td>
                  {c.salesEnabled ? (
                    <button
                      type="button"
                      className="adm-btn adm-btn--danger"
                      onClick={() => setPending({ cat: c, enable: false })}
                    >
                      {t('categories.closeSales')}
                    </button>
                  ) : (
                    c.regulation !== 'prohibited' && (
                      <button
                        type="button"
                        className="adm-btn adm-btn--primary"
                        onClick={() => setPending({ cat: c, enable: true })}
                      >
                        {t('categories.openSales')}
                      </button>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ConfirmActionDialog
        open={pending !== null}
        title={
          pending
            ? t(pending.enable ? 'categories.openTitle' : 'categories.closeTitle', {
                name: pending.cat.name,
              })
            : ''
        }
        description={
          pending ? (
            <>
              <p>{pending.enable ? t('categories.openText') : t('categories.closeText')}</p>
              {pending.enable && pending.cat.regulation === 'regulated' && (
                <label className="adm-field">
                  <span>{t('categories.reference')}</span>
                  <input value={reference} onChange={(e) => setReference(e.target.value)} />
                </label>
              )}
            </>
          ) : null
        }
        confirmText={pending ? `${pending.enable ? 'ENABLE' : 'DISABLE'} ${pending.cat.key}` : ''}
        requireReason
        confirmLabel={pending?.enable ? t('categories.openSales') : t('categories.closeSales')}
        tone="danger"
        onConfirm={act}
        onClose={() => setPending(null)}
      />
    </section>
  );
}
