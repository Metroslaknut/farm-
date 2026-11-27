import { Link } from 'react-router-dom';
import { Alert, Badge, Card } from '../../components/ui';
import { useAuth } from '../../auth/AuthContext';
import { humanize } from '@farmplus/shared-utils';
import { useLocale, useT } from '../../i18n';
import layout from '../../i18n/messages/layout';
import { NavButton } from './NavButton';
import { roleLabel, useFarmsT } from './labels';
import { useFarmSetup } from './useFarmSetup';

export default function UserProfilePage() {
  const { user } = useAuth();
  const [locale] = useLocale();
  const t = useT('layout');
  const value = (text?: string) => text || t('profile.notProvided');
  const date = user?.createdAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(user.createdAt))
    : t('profile.notProvided');

  return (
    <>
      <Card title={t('profile.title')} headingLevel={1} style={{ maxWidth: '42rem' }}>
        <dl className="account-profile__details">
          <div>
            <dt>{t('profile.displayName')}</dt>
            <dd>{value(user?.displayName)}</dd>
          </div>
          <div>
            <dt>{t('profile.email')}</dt>
            <dd>{value(user?.email)}</dd>
          </div>
          <div>
            <dt>{t('profile.phone')}</dt>
            <dd>{value(user?.phone)}</dd>
          </div>
          <div>
            <dt>{t('profile.roles')}</dt>
            <dd>
              {user?.roles.length
                ? user.roles
                    .map((r) =>
                      `profile.role.${r}` in layout.en
                        ? t(`profile.role.${r}` as Parameters<typeof t>[0])
                        : humanize(r),
                    )
                    .join(', ')
                : t('profile.notProvided')}
            </dd>
          </div>
          <div>
            <dt>{t('profile.emailVerified')}</dt>
            <dd>{t(user?.emailVerified ? 'profile.verified' : 'profile.unverified')}</dd>
          </div>
          <div>
            <dt>{t('profile.phoneVerified')}</dt>
            <dd>{t(user?.phoneVerified ? 'profile.verified' : 'profile.unverified')}</dd>
          </div>
          <div>
            <dt>{t('profile.joinedAt')}</dt>
            <dd>{date}</dd>
          </div>
        </dl>
      </Card>
      <ProfileFarms />
    </>
  );
}

/** Farm settings live here once the farm is set up (owners and managers may edit; the API enforces it). */
function ProfileFarms() {
  const t = useFarmsT();
  const { data, error, reload } = useFarmSetup();
  return (
    <Card
      title={t('profile.farms')}
      headingLevel={2}
      style={{ maxWidth: '42rem', marginTop: 'var(--ds-space-4)' }}
    >
      <p>{t('profile.farmsHint')}</p>
      {error && (
        <Alert tone="danger">
          {error}{' '}
          <button type="button" onClick={reload}>
            {t('common.tryAgain')}
          </button>
        </Alert>
      )}
      {!data && !error && <p role="status">{t('common.loading')}</p>}
      {data && data.farms.length === 0 && (
        <>
          <p>{t('profile.noFarm')}</p>
          {data.canCreateFarm ? (
            <NavButton to="/farms/new" variant="primary">
              {t('profile.setupFarm')}
            </NavButton>
          ) : (
            <>
              <p>{t('setup.notAllowed')}</p>
              <NavButton to="/farms/owner-request" variant="primary">
                {t('ownerRequest.link')}
              </NavButton>
            </>
          )}
        </>
      )}
      {data && data.farms.length > 0 && (
        <ul className="ds-stack" style={{ listStyle: 'none', padding: 0 }}>
          {data.farms.map((farm) => (
            <li key={farm.id} className="ds-row" style={{ justifyContent: 'space-between' }}>
              <span className="ds-row">
                <Link to={`/farms/${farm.id}`}>{farm.name}</Link>
                {farm.myRole && <Badge tone="info">{roleLabel(t, farm.myRole)}</Badge>}
                {farm.status === 'archived' && <Badge tone="warning">{t('common.archived')}</Badge>}
                <Badge tone="success">{t('setup.completed')}</Badge>
              </span>
              {(farm.myRole === 'owner' || farm.myRole === 'manager') &&
              farm.status === 'active' ? (
                <NavButton to={`/farms/${farm.id}/edit`}>{t('myFarm.editFarm')}</NavButton>
              ) : (
                <NavButton to={`/farms/${farm.id}`}>{t('profile.openFarm')}</NavButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
