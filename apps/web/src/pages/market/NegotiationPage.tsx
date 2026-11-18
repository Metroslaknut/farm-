import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { NegotiationDTO } from '@farmplus/shared-types';
import { formatBaht, parseBahtToMinor } from '@farmplus/shared-utils';
import { api } from '../../api';
import { Alert, Badge, Button, Card, Modal, TextField } from '../../components/ui';
import { errorMessage } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import {
  codeLabel,
  ListingStatusBadge,
  NEGOTIATION_TONE,
  negotiationStatusLabel,
  rich,
  useDateTime,
  useMarketT,
} from './common';

/** `/market/offers/:id` — one negotiation, for the buyer and the seller side. Every amount on the table is quoted back to the server. */
export default function NegotiationPage() {
  const { id = '' } = useParams();
  const t = useMarketT();
  const dateTime = useDateTime();
  const [version, setVersion] = useState(0);
  const { data, error, loading } = useAsync(
    (signal) =>
      api.request<{ negotiation: NegotiationDTO }>('GET', `/marketplace/negotiations/${id}`, {
        signal,
      }),
    [id, version],
  );
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [msg, setMsg] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'accept' | 'reject' | 'cancel-reservation' | null>(null);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (loading && !data) return <p role="status">{t('loading')}</p>;
  const n = data?.negotiation;
  if (!n) return null;
  const me = n.viewer.party;
  const base = `/marketplace/negotiations/${n.id}`;

  const run = async (path: string, body: object = {}) => {
    setBusy(true);
    setMsg(undefined);
    try {
      await api.request('POST', `${base}/${path}`, { body });
      setConfirm(null);
      setAmount('');
      setMessage('');
      setVersion((v) => v + 1);
    } catch (e) {
      setMsg(errorMessage(e));
      setConfirm(null);
      setVersion((v) => v + 1); // the state changed under us: show the latest
    } finally {
      setBusy(false);
    }
  };

  const counter = () => {
    const minor = parseBahtToMinor(amount);
    if (minor === undefined) return setMsg(t('neg.err.amount'));
    void run('counter', {
      amountMinor: minor,
      expectedSeq: n.currentSeq,
      ...(message.trim() ? { message: message.trim() } : {}),
    });
  };

  return (
    <>
      <p>
        <Link to={me === 'buyer' ? '/market/offers' : '/market/sell'}>
          {me === 'buyer' ? t('nav.myOffers') : t('nav.selling')}
        </Link>
      </p>
      <div className="ds-row" style={{ justifyContent: 'space-between' }}>
        <h1>{n.listingTitle}</h1>
        <span className="ds-row">
          <Badge tone={NEGOTIATION_TONE[n.status]}>{negotiationStatusLabel(t, n.status)}</Badge>
          <ListingStatusBadge status={n.listingStatus} />
        </span>
      </div>
      <p>
        {rich(
          t('neg.summary', {
            amount: formatBaht(n.askingPriceMinor),
            who:
              me === 'buyer'
                ? t('neg.sellerName', { name: n.seller.displayName })
                : t('neg.buyerName', { name: n.buyer.displayName }),
          }),
          { link: <Link to={`/market/listing/${n.listingId}`}>{t('neg.viewListing')}</Link> },
        )}
      </p>
      {msg && <Alert tone="danger">{msg}</Alert>}
      {me === 'moderator' && <Alert tone="info">{t('neg.moderator')}</Alert>}

      {n.status === 'open' && (
        <Card
          title={t('neg.onTable', { amount: formatBaht(n.currentOfferMinor) })}
          headingLevel={2}
        >
          <p>
            {n.turn === me ? (
              <strong>{t('neg.yourTurn')}</strong>
            ) : n.turn ? (
              t('neg.waiting', { party: t(`party.${n.turn}`) })
            ) : null}{' '}
            {n.offerExpiresAt && (
              <span className="ds-field__hint">
                {t('neg.validUntil', { date: dateTime(n.offerExpiresAt) })}
              </span>
            )}
          </p>
          {n.viewer.canAct && (
            <>
              <div className="ds-row">
                <Button variant="primary" onClick={() => setConfirm('accept')}>
                  {t('neg.accept', { amount: formatBaht(n.currentOfferMinor) })}
                </Button>
                <Button variant="danger" onClick={() => setConfirm('reject')}>
                  {me === 'buyer' ? t('neg.decline') : t('neg.declineOffer')}
                </Button>
              </div>
              <h3>{t('neg.orCounter')}</h3>
              <div className="ds-grid ds-grid--2" style={{ alignItems: 'end' }}>
                <TextField
                  label={t('neg.counterLabel')}
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <TextField
                  label={t('neg.messageLabel')}
                  value={message}
                  maxLength={500}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </div>
              <Button loading={busy} onClick={counter}>
                {t('neg.sendCounter')}
              </Button>
            </>
          )}
          {me === 'buyer' && n.turn !== 'buyer' && (
            <Button onClick={() => void run('withdraw')}>{t('neg.withdraw')}</Button>
          )}
        </Card>
      )}

      {n.status === 'accepted' && n.order && (
        <Alert tone="success">
          {rich(t('neg.agreed', { date: dateTime(n.order.reservedUntil) }), {
            amount: <strong>{formatBaht(n.order.amountMinor)}</strong>,
          })}
          {me === 'buyer' &&
            (n.order.orderId ? (
              <>
                {' '}
                <Link to={`/market/orders/${n.order.orderId}`} className="ds-btn ds-btn--primary">
                  {t('neg.viewOrder')}
                </Link>
              </>
            ) : (
              <>
                {' '}
                <Link to={`/market/checkout/${n.id}`} className="ds-btn ds-btn--primary">
                  {t('neg.checkout')}
                </Link>
              </>
            ))}
          {me !== 'moderator' && !n.order.orderId && (
            <>
              {' '}
              <Button size="sm" variant="danger" onClick={() => setConfirm('cancel-reservation')}>
                {t('neg.cancelDeal')}
              </Button>
            </>
          )}
        </Alert>
      )}
      {n.status === 'completed' && (
        <Alert tone="success">{t('neg.soldAt', { amount: formatBaht(n.currentOfferMinor) })}</Alert>
      )}
      {['rejected', 'withdrawn', 'expired', 'cancelled'].includes(n.status) &&
        me === 'buyer' &&
        n.listingStatus === 'ACTIVE' && (
          <p>
            {rich(t('neg.closed'), {
              link: <Link to={`/market/listing/${n.listingId}`}>{t('neg.newOffer')}</Link>,
            })}
          </p>
        )}

      <Card title={t('history')} headingLevel={2} style={{ marginTop: 'var(--ds-space-4)' }}>
        <ol
          style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--ds-space-3)' }}
          aria-label={t('neg.historyAria')}
        >
          {n.history.map((h) => (
            <li key={h.seq}>
              <strong>{h.actor.displayName}</strong> ({t(`party.${h.by}`)}){' '}
              {t(`neg.event.${h.type}`)}
              {h.amountMinor ? (
                <>
                  {' '}
                  <strong>{formatBaht(h.amountMinor)}</strong>
                </>
              ) : null}
              <span className="ds-field__hint"> · {dateTime(h.at)}</span>
              {h.message && <p style={{ margin: 0, fontStyle: 'italic' }}>“{h.message}”</p>}
              {h.reason && (
                <p style={{ margin: 0 }} className="ds-field__hint">
                  {codeLabel(t, 'reason', h.reason)}
                </p>
              )}
            </li>
          ))}
        </ol>
        <p className="ds-field__hint">{t('neg.immutable')}</p>
      </Card>

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={
          confirm === 'accept'
            ? t('neg.confirmAccept', { amount: formatBaht(n.currentOfferMinor) })
            : confirm === 'reject'
              ? t('neg.confirmReject')
              : t('neg.confirmCancel')
        }
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>{t('back')}</Button>
            <Button
              variant={confirm === 'accept' ? 'primary' : 'danger'}
              loading={busy}
              onClick={() =>
                void (confirm === 'accept'
                  ? run('accept', { expectedSeq: n.currentSeq })
                  : confirm === 'reject'
                    ? run(me === 'buyer' ? 'withdraw' : 'reject', { expectedSeq: n.currentSeq })
                    : run('cancel-reservation'))
              }
            >
              {confirm === 'accept'
                ? t('neg.acceptBtn')
                : confirm === 'reject'
                  ? t('neg.decline')
                  : t('neg.cancelDeal')}
            </Button>
          </>
        }
      >
        {confirm === 'accept' ? (
          <p>{me === 'seller' ? t('neg.acceptText.seller') : t('neg.acceptText.buyer')}</p>
        ) : confirm === 'reject' ? (
          <p>{me === 'buyer' ? t('neg.rejectText.buyer') : t('neg.rejectText.seller')}</p>
        ) : (
          <p>{t('neg.cancelText')}</p>
        )}
      </Modal>
    </>
  );
}
