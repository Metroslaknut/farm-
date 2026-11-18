import { Navigate, Outlet } from 'react-router-dom';
import { Alert } from '../../components/ui';
import { useFarmsT } from './labels';
import { useFarmSetup } from './useFarmSetup';

/**
 * Onboarding guard for the farm area: a user who may create a farm but has none is sent to the farm setup and
 * cannot skip it. Users who may not create farms (buyers) are never forced. The API enforces access regardless.
 */
export default function RequireFarmSetup() {
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
  if (!data) return <p role="status">{t('setup.checking')}</p>;
  if (data.status === 'farm_setup_required')
    return <Navigate to="/farms/new" replace state={{ setupRequired: true }} />;
  return <Outlet />;
}
