import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CHAT_LIMITS, type ConversationDTO } from '@farmplus/shared-types';
import { api } from '../../api';
import { Alert, Button } from '../ui';
import { useT } from '../../i18n';
import { errorMessage } from '../../lib/format';

/** "Message seller": opens (or continues) the one conversation between this buyer and the farm, about a listing or product. */
export function ContactSellerButton({
  listingId,
  productId,
}: {
  listingId?: string;
  productId?: string;
}) {
  const navigate = useNavigate();
  const t = useT('inbox');
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await api.request<{ conversation: ConversationDTO }>('POST', '/conversations', {
        body: { ...(listingId ? { listingId } : { productId }), message: text.trim() },
      });
      navigate(`/messages/${res.conversation.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  if (!open) return <Button onClick={() => setOpen(true)}>{t('contact.button')}</Button>;
  return (
    <form onSubmit={(e) => void submit(e)} aria-label={t('contact.aria')}>
      {error && <Alert tone="danger">{error}</Alert>}
      <label>
        {t('contact.message')}
        <textarea
          value={text}
          maxLength={CHAT_LIMITS.body}
          rows={3}
          onChange={(e) => setText(e.target.value)}
          style={{ display: 'block', width: '100%' }}
        />
      </label>
      <p>
        <Button type="submit" variant="primary" loading={busy} disabled={!text.trim()}>
          {t('send')}
        </Button>{' '}
        <Button onClick={() => setOpen(false)}>{t('contact.cancel')}</Button>
      </p>
    </form>
  );
}
