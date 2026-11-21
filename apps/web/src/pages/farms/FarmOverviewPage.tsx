import { Link, useParams } from 'react-router-dom';
import { ANIMAL_STATUSES } from '@farmplus/shared-types';
import { Alert, Badge, Card } from '../../components/ui';
import { NavButton } from './NavButton';
import { STATUS_TONE, enumLabel, roleLabel, useFarmsT } from './labels';
import { useFarm } from './useFarmAccess';

/** Farm details (location, contact, role) and shortcuts; the farm menu itself lives in the dashboard sidebar. */
export default function FarmOverviewPage() {
  const t = useFarmsT();
  const { farmId } = useParams();
  const { farm, loading, error, reload, can } = useFarm(farmId);
  if (error)
    return (
      <Alert tone="danger">
        {error}{' '}
        <button type="button" onClick={reload}>
          {t('common.tryAgain')}
        </button>
      </Alert>
    );
  if (loading || !farm) return <p role="status">{t('overview.loading')}</p>;

  const loc = [
    farm.location.address,
    farm.location.subdistrict,
    farm.location.district,
    farm.location.province,
    farm.location.postalCode,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <>
      <p>
        <Link to={`/farms/${farm.id}`}>← {t('shell.overview')}</Link>
      </p>
      <div className="ds-row" style={{ justifyContent: 'space-between' }}>
        <h1>
          {farm.name}{' '}
          {farm.status === 'archived' && <Badge tone="warning">{t('common.archived')}</Badge>}
        </h1>
        <span className="ds-row">
          {farm.myRole ? (
            <Badge tone="info">{roleLabel(t, farm.myRole)}</Badge>
          ) : (
            <Badge>{t('overview.platformAccess')}</Badge>
          )}
        </span>
      </div>
      {farm.status === 'archived' && <Alert tone="warning">{t('common.farmArchived')}</Alert>}
      {farm.description && <p>{farm.description}</p>}

      <div className="ds-grid ds-grid--2">
        <Card title={t('overview.animals')} headingLevel={2}>
          <p>
            <strong>{farm.stats.animalsTotal}</strong> {t('overview.onFarm')} ·{' '}
            <strong>{farm.stats.animalsActive}</strong> {t('overview.active')}
          </p>
          <p className="ds-row">
            {ANIMAL_STATUSES.filter((s) => farm.stats.byStatus[s]).map((s) => (
              <Badge key={s} tone={STATUS_TONE[s]}>
                {enumLabel(t, 'status', s)}: {farm.stats.byStatus[s]}
              </Badge>
            ))}
          </p>
          <div className="ds-card__footer">
            <NavButton to={`/farms/${farm.id}/animals`}>{t('overview.viewAnimals')}</NavButton>
            {can('animals.write') && farm.status === 'active' && (
              <NavButton to={`/farms/${farm.id}/animals/new`} variant="primary">
                {t('animals.register')}
              </NavButton>
            )}
          </div>
        </Card>
        {can('records.read') && (
          <Card title={t('overview.records')} headingLevel={2}>
            <p>
              {can('expenses.read')
                ? t('overview.recordsHintWithCosts')
                : t('overview.recordsHint')}
            </p>
            <div className="ds-row">
              {can('breeding.read') && (
                <NavButton to={`/farms/${farm.id}/breeding`}>{t('kind.breeding.plural')}</NavButton>
              )}
              <NavButton to={`/farms/${farm.id}/health`}>{t('overview.health')}</NavButton>
              <NavButton to={`/farms/${farm.id}/weights`}>{t('kind.weights.plural')}</NavButton>
              <NavButton to={`/farms/${farm.id}/feeding`}>{t('kind.feeding.plural')}</NavButton>
              {can('expenses.read') && (
                <NavButton to={`/farms/${farm.id}/expenses`}>{t('kind.expenses.plural')}</NavButton>
              )}
            </div>
          </Card>
        )}
        {can('listings.manage') && (
          <Card title={t('overview.marketplace')} headingLevel={2}>
            <p>{t('overview.marketplaceHint')}</p>
            <NavButton to={`/farms/${farm.id}/listings`}>{t('overview.openListings')}</NavButton>
          </Card>
        )}
        <Card title={t('overview.dashboard')} headingLevel={2}>
          <p>
            {can('expenses.read')
              ? t('overview.dashboardHintWithCosts')
              : t('overview.dashboardHint')}
          </p>
          <NavButton to={`/farms/${farm.id}/dashboard`}>{t('overview.openDashboard')}</NavButton>
        </Card>
        <Card title={t('overview.locationContact')} headingLevel={2}>
          <p>{loc || t('common.locationNotSet')}</p>
          <p>
            {[
              farm.contact.phone,
              farm.contact.email,
              farm.contact.lineId && `LINE: ${farm.contact.lineId}`,
            ]
              .filter(Boolean)
              .join(' · ') || t('overview.noContact')}
          </p>
        </Card>
      </div>
    </>
  );
}
