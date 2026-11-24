import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { App } from './App';
import { PublicLayout } from './app/layouts/PublicLayout';
import { AuthProvider } from './auth/AuthContext';
import NotFoundPage from './pages/NotFoundPage';
import './index.css';

// The admin area is a separate lazy chunk: the public bundle does not grow, and the public page at "/"
// (and any other public path) renders exactly as before.
const AdminApp = lazy(() => import('./pages/admin/AdminApp'));
const DesignSystem = lazy(() => import('./pages/design-system'));
const FarmsApp = lazy(() => import('./pages/farms/FarmsApp'));
const CommunityApp = lazy(() => import('./pages/community/CommunityApp'));
const VideosApp = lazy(() => import('./pages/videos/VideosApp'));
const LiveApp = lazy(() => import('./pages/live/LiveApp'));
const MarketApp = lazy(() => import('./pages/market/MarketApp'));
const InboxApp = lazy(() => import('./pages/inbox/InboxApp'));
const ShopApp = lazy(() => import('./pages/shop/ShopApp'));
// The help centre and its articles are their own chunk: nothing of it loads on other pages.
const HelpApp = lazy(() => import('./pages/help/HelpApp'));

// The design-system preview is an internal page: on in development, opt-in elsewhere.
const previewEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DESIGN_PREVIEW === 'true';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      {/* One session for the whole site: moving between areas must not re-check the sign-in. */}
      <AuthProvider>
        <Routes>
          <Route element={<PublicLayout wide />}>
            <Route path="/" element={<App />} />
          </Route>
          <Route
            path="/admin/*"
            element={
              <Suspense fallback={<p role="status">Loading…</p>}>
                <AdminApp />
              </Suspense>
            }
          />
          <Route
            path="/farms/*"
            element={
              <Suspense fallback={<p role="status">Loading…</p>}>
                <FarmsApp />
              </Suspense>
            }
          />
          <Route
            path="/community/*"
            element={
              <Suspense fallback={<p role="status">Loading…</p>}>
                <CommunityApp />
              </Suspense>
            }
          />
          <Route
            path="/videos/*"
            element={
              <Suspense fallback={<p role="status">Loading…</p>}>
                <VideosApp />
              </Suspense>
            }
          />
          <Route
            path="/live/*"
            element={
              <Suspense fallback={<p role="status">Loading…</p>}>
                <LiveApp />
              </Suspense>
            }
          />
          <Route
            path="/shop/*"
            element={
              <Suspense fallback={<p role="status">Loading…</p>}>
                <ShopApp />
              </Suspense>
            }
          />
          <Route
            path="/market/*"
            element={
              <Suspense fallback={<p role="status">Loading…</p>}>
                <MarketApp />
              </Suspense>
            }
          />
          {/* Public: no sign-in needed (how to register and sign in is part of it). */}
          <Route element={<PublicLayout />}>
            <Route
              path="/help/*"
              element={
                <Suspense fallback={<p role="status">Loading…</p>}>
                  <HelpApp />
                </Suspense>
              }
            />
          </Route>
          <Route
            path="/notifications/*"
            element={
              <Suspense fallback={<p role="status">Loading…</p>}>
                <InboxApp area="notifications" />
              </Suspense>
            }
          />
          <Route
            path="/messages/*"
            element={
              <Suspense fallback={<p role="status">Loading…</p>}>
                <InboxApp area="messages" />
              </Suspense>
            }
          />
          {previewEnabled && (
            <Route
              path="/design-system/*"
              element={
                <Suspense fallback={<p role="status">Loading…</p>}>
                  <DesignSystem />
                </Suspense>
              }
            />
          )}
          {/* Unknown URLs: a "page not found" page in the site layout (not the home page). */}
          <Route element={<PublicLayout />}>
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
