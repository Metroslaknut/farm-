import { Route, Routes } from 'react-router-dom';
import { PublicLayout } from '../../app/layouts/PublicLayout';
import AnimalDetailPage from './AnimalDetailPage';
import AnimalFormPage from './AnimalFormPage';
import AnimalListPage from './AnimalListPage';
import AccountSettingsPage from './AccountSettingsPage';
import UserProfilePage from './UserProfilePage';
import FarmDashboardPage from './FarmDashboardPage';
import FarmHomePage from './FarmHomePage';
import FarmIndexPage from './FarmIndexPage';
import FarmFormPage from './FarmFormPage';
import FarmListPage from './FarmListPage';
import FarmOverviewPage from './FarmOverviewPage';
import LineagePage from './LineagePage';
import TradesPage from './TradesPage';
import OAuthCallbackPage from './OAuthCallbackPage';
import RegisterPage from './RegisterPage';
import RequireFarmSetup from './RequireFarmSetup';
import RequireSignIn from './RequireSignIn';
import SignInPage from './SignInPage';
import { FarmShell } from './shell/FarmShell';
import { ManageListingPage, NewListingPage, SellListingsPage } from '../market/SellPages';
import VerifyEmailPage from './VerifyEmailPage';
import AnimalHistoryPage from './records/AnimalHistoryPage';
import AssessmentPage from './AssessmentPage';
import GrowthPage from './records/GrowthPage';
import PedigreePage from './records/PedigreePage';
import RecordDetailPage from './records/RecordDetailPage';
import RecordFormPage from './records/RecordFormPage';
import RecordListPage from './records/RecordListPage';
import { KIND_LIST } from './records/recordConfigs';

/** Everything under /farms: sign-in and farm setup (public layout), then farm management in the dashboard layout. */
export default function FarmsApp() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="sign-in" element={<SignInPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="verify-email" element={<VerifyEmailPage />} />
        <Route path="oauth-callback" element={<OAuthCallbackPage />} />
        <Route element={<RequireSignIn />}>
          <Route path="new" element={<FarmFormPage />} />
        </Route>
      </Route>
      {/* Signed-in farm management uses the dashboard layout (sidebar menu, top bar). */}
      <Route element={<RequireSignIn />}>
        <Route element={<FarmShell />}>
          <Route path="profile" element={<UserProfilePage />} />
          <Route path="settings" element={<AccountSettingsPage />} />
          <Route element={<RequireFarmSetup />}>
            <Route index element={<FarmIndexPage />} />
            <Route path="list" element={<FarmListPage />} />
            <Route path=":farmId" element={<FarmHomePage />} />
            <Route path=":farmId/info" element={<FarmOverviewPage />} />
            <Route path=":farmId/edit" element={<FarmFormPage />} />
            <Route path=":farmId/dashboard" element={<FarmDashboardPage />} />
            <Route path=":farmId/animals" element={<AnimalListPage />} />
            <Route path=":farmId/animals/new" element={<AnimalFormPage />} />
            <Route path=":farmId/animals/:animalId" element={<AnimalDetailPage />} />
            <Route path=":farmId/animals/:animalId/edit" element={<AnimalFormPage />} />
            <Route path=":farmId/animals/:animalId/growth" element={<GrowthPage />} />
            <Route path=":farmId/animals/:animalId/lineage" element={<PedigreePage />} />
            <Route path=":farmId/lineage" element={<LineagePage />} />
            <Route path=":farmId/trades" element={<TradesPage />} />
            <Route path=":farmId/listings" element={<SellListingsPage />} />
            <Route path=":farmId/listings/new" element={<NewListingPage />} />
            <Route path=":farmId/listings/:id" element={<ManageListingPage />} />
            <Route path=":farmId/animals/:animalId/assessment" element={<AssessmentPage />} />
            <Route path=":farmId/animals/:animalId/history" element={<AnimalHistoryPage />} />
            {KIND_LIST.flatMap((c) => [
              <Route
                key={`${c.path}-l`}
                path={`:farmId/${c.path}`}
                element={<RecordListPage config={c} />}
              />,
              <Route
                key={`${c.path}-n`}
                path={`:farmId/${c.path}/new`}
                element={<RecordFormPage config={c} />}
              />,
              <Route
                key={`${c.path}-d`}
                path={`:farmId/${c.path}/:id`}
                element={<RecordDetailPage config={c} />}
              />,
              <Route
                key={`${c.path}-e`}
                path={`:farmId/${c.path}/:id/edit`}
                element={<RecordFormPage config={c} />}
              />,
            ])}
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}
