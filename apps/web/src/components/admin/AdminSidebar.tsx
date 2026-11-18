import { NavLink } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useAdminI18n } from './i18n';
import { visibleNav } from './nav';

export function AdminSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { canAny } = useAuth();
  const { t } = useAdminI18n();
  const groups = visibleNav(canAny);
  return (
    <nav className="adm-sidebar__nav" aria-label={t('sidebar.label')}>
      {groups.map((group) => (
        <div key={group.labelKey} className="adm-sidebar__group">
          <p className="adm-sidebar__label">{t(group.labelKey)}</p>
          <ul>
            {group.items.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={`/admin/${item.path}`}
                  onClick={onNavigate}
                  className={({ isActive }) => (isActive ? 'is-active' : undefined)}
                >
                  {t(item.labelKey)}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {groups.length === 0 && <p className="adm-muted">{t('sidebar.none')}</p>}
    </nav>
  );
}
