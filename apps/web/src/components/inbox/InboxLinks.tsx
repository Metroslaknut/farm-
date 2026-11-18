import { Link } from 'react-router-dom';
import { useT } from '../../i18n';
import { useInbox } from '../../lib/inbox';
import { Icon } from '../layout/Icon';
import './inbox.css';

const shown = (n: number) => (n > 99 ? '99+' : String(n));

/** Header shortcuts: notifications and messages, each with its unread counter (hidden when signed out). */
export function InboxLinks() {
  const { counts, state, client } = useInbox();
  const t = useT('layout');
  if (!client) return null;
  return (
    <span className="inbox-links">
      <Link
        to="/notifications"
        className="inbox-link"
        aria-label={t('inbox.notifications', { count: counts.notifications })}
      >
        <Icon name="bell" />
        {counts.notifications > 0 && (
          <span className="inbox-badge">{shown(counts.notifications)}</span>
        )}
      </Link>
      <Link
        to="/messages"
        className="inbox-link"
        aria-label={t('inbox.messages', { count: counts.messages })}
      >
        <Icon name="chat" />
        {counts.messages > 0 && <span className="inbox-badge">{shown(counts.messages)}</span>}
      </Link>
      {state === 'reconnecting' && (
        <span className="inbox-status" role="status" title={t('inbox.reconnecting')}>
          ⟳
        </span>
      )}
    </span>
  );
}
