import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { rich, useAdminI18n } from '../../components/admin/i18n';
import { PermissionGuard, StateMessage, visibleNavFirst } from './guard-helpers';

export function RequireAdminAuth() {
  const { status } = useAuth();
  const location = useLocation();
  const { t } = useAdminI18n();
  if (status === 'loading')
    return <StateMessage kind="loading">{t('guard.checking')}</StateMessage>;
  if (status === 'anonymous')
    return (
      <Navigate to="/admin/login" replace state={{ from: location.pathname + location.search }} />
    );
  return <Outlet />;
}

export function Forbidden() {
  const { t } = useAdminI18n();
  return (
    <div className="adm-card" role="alert">
      <h1>{t('guard.forbiddenTitle')}</h1>
      <p className="adm-muted">{t('guard.forbiddenText')}</p>
    </div>
  );
}

export function NotFound() {
  const { t } = useAdminI18n();
  return (
    <div className="adm-card">
      <h1>{t('guard.notFoundTitle')}</h1>
      <p className="adm-muted">{t('guard.notFoundText')}</p>
    </div>
  );
}

/** Wrap a page so it renders only for holders of ANY of the listed permissions. */
export function Protected({
  anyOf,
  children,
}: {
  anyOf: readonly string[];
  children: React.ReactNode;
}) {
  return (
    <PermissionGuard anyOf={anyOf} fallback={<Forbidden />}>
      {children}
    </PermissionGuard>
  );
}

/** `/admin` landing: send the user to the first section they may open, or explain why there is none. */
export function AdminHome() {
  const { canAny, mfaRequired, user } = useAuth();
  const { t } = useAdminI18n();
  const first = visibleNavFirst(canAny);
  if (first) return <Navigate to={`/admin/${first}`} replace />;
  return (
    <div className="adm-card">
      <h1>{user ? t('guard.welcomeName', { name: user.displayName }) : t('guard.welcome')}</h1>
      {mfaRequired ? (
        <p>
          {rich(t('guard.mfaHold'), {
            link: <a href="/admin/account/security">{t('guard.mfaLink')}</a>,
          })}
        </p>
      ) : (
        <p className="adm-muted">{t('guard.noAccess')}</p>
      )}
    </div>
  );
}
