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
import FarmStaffPage from './FarmStaffPage';
import MyInvitationsPage from './MyInvitationsPage';
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
import SellerRegistrationPage, { FarmOwnerRequestPage } from './SellerRegistrationPage';
import ForgotPasswordPage from './ForgotPasswordPage';
import ResetPasswordPage from './ResetPasswordPage';
import RecordDetailPage from './records/RecordDetailPage';
import RecordFormPage from './records/RecordFormPage';
import RecordListPage from './records/RecordListPage';
import { KIND_LIST } from './records/recordConfigs';
import NotFoundPage from '../NotFoundPage';

/** Everything under /farms: sign-in and farm setup (public layout), then farm management in the dashboard layout. */
export default function FarmsApp() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="sign-in" element={<SignInPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="verify-email" element={<VerifyEmailPage />} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
        <Route path="reset-password" element={<ResetPasswordPage />} />
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
          {/* Reachable without a farm of one's own: an invitation may be how a person gets their first farm. */}
          <Route path="invitations" element={<MyInvitationsPage />} />
          {/* Anyone signed in may apply to sell; no farm needed (a seller may only sell products). */}
          <Route path="seller" element={<SellerRegistrationPage />} />
          {/* Creating farms needs an approved farm-owner request (setting farms.requireFarmOwnerRole). */}
          <Route path="owner-request" element={<FarmOwnerRequestPage />} />
          <Route element={<RequireFarmSetup />}>
            <Route index element={<FarmIndexPage />} />
            <Route path="list" element={<FarmListPage />} />
            <Route path=":farmId" element={<FarmHomePage />} />
            <Route path=":farmId/info" element={<FarmOverviewPage />} />
            <Route path=":farmId/edit" element={<FarmFormPage />} />
            <Route path=":farmId/staff" element={<FarmStaffPage />} />
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
                element={<RecordListPage key={c.kind} config={c} />}
              />,
              <Route
                key={`${c.path}-n`}
                path={`:farmId/${c.path}/new`}
                element={<RecordFormPage key={`${c.kind}-new`} config={c} />}
              />,
              <Route
                key={`${c.path}-d`}
                path={`:farmId/${c.path}/:id`}
                element={<RecordDetailPage key={c.kind} config={c} />}
              />,
              <Route
                key={`${c.path}-e`}
                path={`:farmId/${c.path}/:id/edit`}
                element={<RecordFormPage key={`${c.kind}-edit`} config={c} />}
              />,
            ])}
          </Route>
          {/* Unknown paths under /farms show "not found" inside the farm shell instead of a blank page. */}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
