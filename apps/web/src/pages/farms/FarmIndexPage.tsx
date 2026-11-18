import { Navigate } from 'react-router-dom';
import { Alert } from '../../components/ui';
import FarmListPage from './FarmListPage';
import { useFarmsT } from './labels';
import { useFarmSetup } from './useFarmSetup';

/** "My farm": opens the dashboard of the user's first farm. Users without a farm (buyers) see the farm list. */
export default function FarmIndexPage() {
  const t = useFarmsT();
  const { data, error, reload } = useFarmSetup();
  if (error)
    return (
      <Alert tone="danger">
        {error}{' '}
        <button type="button" onClick={reload}>
          {t('common.tryAgain')}
        </button>
      </Alert>
    );
  if (!data) return <p role="status">{t('list.loading')}</p>;
  const first = data.farms[0];
  return first ? <Navigate to={`/farms/${first.id}`} replace /> : <FarmListPage />;
}
