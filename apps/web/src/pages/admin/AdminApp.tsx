import { Route, Routes } from 'react-router-dom';
import { AdminLayout } from '../../components/admin';
import { ALL_NAV_ITEMS } from '../../components/admin/nav';
import AnalyticsPage from './analytics';
import AnimalTypesPage from './animal-types';
import GrowthStandardsPage from './growth-standards';
import SecurityPage from './account/SecurityPage';
import AuditLogsPage from './audit-logs';
import CommissionsPage from './commissions';
import DashboardPage from './dashboard';
import FarmsPage from './farms';
import AiAdminPage from './ai';
import ListingsPage from './listings';
import AdminLogin from './login';
import MessageReportsPage from './message-reports';
import ModerationPage from './moderation';
import OrdersPage from './orders';
import OrderDetail from './orders/OrderDetail';
import PaymentsPage from './payments';
import PermissionsPage from './permissions';
import ProductsPage from './products';
import RegistrationDetail from './registrations/RegistrationDetail';
import RegistrationsPage from './registrations';
import RefundsPage from './refunds';
import ReportsPage from './reports';
import RolesPage from './roles';
import RoleForm from './roles/RoleForm';
import { AdminHome, NotFound, Protected, RequireAdminAuth } from './RouteGuards';
import SettingsPage from './settings';
import UserDetail from './users/UserDetail';
import UsersPage from './users';
import WalletTransactionsPage from './wallet-transactions';
import WithdrawalsPage from './withdrawals';

const need = (path: string): readonly string[] =>
  ALL_NAV_ITEMS.find((i) => i.path === path)?.anyOf ?? [];
const guarded = (path: string, element: React.ReactNode) => (
  <Protected anyOf={need(path)}>{element}</Protected>
);

/** Everything under /admin. Each page is wrapped in the same permission rule the sidebar uses. */
export default function AdminApp() {
  return (
    <Routes>
      <Route path="login" element={<AdminLogin />} />
      <Route element={<RequireAdminAuth />}>
        <Route element={<AdminLayout />}>
          <Route index element={<AdminHome />} />
          <Route path="account/security" element={<SecurityPage />} />
          <Route path="dashboard" element={guarded('dashboard', <DashboardPage />)} />
          <Route path="registrations" element={guarded('registrations', <RegistrationsPage />)} />
          <Route
            path="registrations/:id"
            element={guarded('registrations', <RegistrationDetail />)}
          />
          <Route path="users" element={guarded('users', <UsersPage />)} />
          <Route path="users/:id" element={guarded('users', <UserDetail />)} />
          <Route path="roles" element={guarded('roles', <RolesPage />)} />
          <Route
            path="roles/new"
            element={
              <Protected anyOf={['roles.manage']}>
                <RoleForm />
              </Protected>
            }
          />
          <Route path="roles/:id" element={guarded('roles', <RoleForm />)} />
          <Route path="permissions" element={guarded('permissions', <PermissionsPage />)} />
          <Route path="payments" element={guarded('payments', <PaymentsPage />)} />
          <Route path="refunds" element={guarded('refunds', <RefundsPage />)} />
          <Route path="withdrawals" element={guarded('withdrawals', <WithdrawalsPage />)} />
          <Route
            path="wallet-transactions"
            element={guarded('wallet-transactions', <WalletTransactionsPage />)}
          />
          <Route path="commissions" element={guarded('commissions', <CommissionsPage />)} />
          <Route path="farms" element={guarded('farms', <FarmsPage />)} />
          <Route path="listings" element={guarded('listings', <ListingsPage />)} />
          <Route path="animal-types" element={guarded('animal-types', <AnimalTypesPage />)} />
          <Route
            path="growth-standards"
            element={guarded('growth-standards', <GrowthStandardsPage />)}
          />
          <Route path="ai" element={guarded('ai', <AiAdminPage />)} />
          <Route path="moderation" element={guarded('moderation', <ModerationPage />)} />
          <Route
            path="message-reports"
            element={guarded('message-reports', <MessageReportsPage />)}
          />
          <Route path="products" element={guarded('products', <ProductsPage />)} />
          <Route path="orders" element={guarded('orders', <OrdersPage />)} />
          <Route path="orders/:id" element={guarded('orders', <OrderDetail />)} />
          <Route path="analytics" element={guarded('analytics', <AnalyticsPage />)} />
          <Route path="reports" element={guarded('reports', <ReportsPage />)} />
          <Route path="audit-logs" element={guarded('audit-logs', <AuditLogsPage />)} />
          <Route path="settings" element={guarded('settings', <SettingsPage />)} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
