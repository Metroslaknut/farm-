import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { RouteErrorBoundary } from '../layout/RouteErrorBoundary';
import { AdminHeader } from './AdminHeader';
import { AdminSidebar } from './AdminSidebar';
import './admin.css';

export function AdminLayout() {
  const { pathname } = useLocation();
  // The menu is "open for" one path; navigating elsewhere closes it without an effect.
  const [openFor, setOpenFor] = useState<string | null>(null);
  const menuOpen = openFor === pathname;
  const setMenuOpen = (open: boolean | ((o: boolean) => boolean)) =>
    setOpenFor((open instanceof Function ? open(menuOpen) : open) ? pathname : null);

  return (
    <div className="adm-root">
      <AdminHeader menuOpen={menuOpen} onToggleMenu={() => setMenuOpen((o) => !o)} />
      <div className="adm-body">
        <aside id="adm-sidebar" className={`adm-sidebar${menuOpen ? ' is-open' : ''}`}>
          <AdminSidebar onNavigate={() => setMenuOpen(false)} />
        </aside>
        {menuOpen && (
          <div className="adm-scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />
        )}
        <main className="adm-main" id="adm-main">
          <RouteErrorBoundary>
            <Outlet />
          </RouteErrorBoundary>
        </main>
      </div>
    </div>
  );
}
