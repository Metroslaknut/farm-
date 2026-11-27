import { Link } from 'react-router-dom';
import { Alert } from '../../components/ui';
import { useAsync } from '../../lib/useAsync';
import { useFarmsT } from './labels';
import { latestOf, loadMyRegistrations, registrationStatusLabel } from './SellerRegistrationPage';

/**
 * "Only approved sellers can …" on the sell forms, with the caller's seller application status (if any) and a link to
 * `/farms/seller` to apply or follow it. `message` is the area's own sentence (listing an animal / a product).
 */
export function SellerRequiredNotice({
  message,
  'data-tour': tourAnchor,
}: {
  message: string;
  /** Guided-tour anchor, put on the link to the seller application. */
  'data-tour'?: string;
}) {
  const t = useFarmsT();
  const { data } = useAsync((signal) => loadMyRegistrations(signal), []);
  const seller = latestOf(data?.registrations, 'seller');
  // A rejected application can be sent again; anything else is followed on the same page.
  const apply = !seller || seller.status === 'REJECTED';
  return (
    <Alert tone="warning">
      {message}{' '}
      {seller && (
        <>{t('seller.notice.status', { status: registrationStatusLabel(t, seller.status) })} </>
      )}
      <Link to="/farms/seller" data-tour={tourAnchor}>
        {t(apply ? 'seller.notice.apply' : 'seller.notice.view')}
      </Link>
    </Alert>
  );
}
