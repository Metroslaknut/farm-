import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useT } from '../../i18n';

/** Route guard for the signed-in public areas (/farms, /community). Anonymous visitors go to the sign-in page and come back. */
export default function RequireSignIn() {
  const { status } = useAuth();
  const location = useLocation();
  const t = useT('auth');
  if (status === 'loading') return <p role="status">{t('guard.checking')}</p>;
  if (status === 'anonymous') {
    return (
      <Navigate to="/farms/sign-in" replace state={{ from: location.pathname + location.search }} />
    );
  }
  return <Outlet />;
}
