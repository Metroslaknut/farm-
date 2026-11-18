import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { LanguageToggle } from '../layout/LanguageToggle';
import { useAdminI18n } from './i18n';

export function AdminHeader({
  menuOpen,
  onToggleMenu,
}: {
  menuOpen: boolean;
  onToggleMenu: () => void;
}) {
  const { user, logout } = useAuth();
  const { t, apiText } = useAdminI18n();
  return (
    <header className="adm-header">
      <button
        type="button"
        className="adm-btn adm-menu-btn"
        aria-expanded={menuOpen}
        aria-controls="adm-sidebar"
        onClick={onToggleMenu}
      >
        {t('header.menu')}
      </button>
      <Link to="/admin" className="adm-brand">
        FARM+ <span className="adm-muted">{t('header.admin')}</span>
      </Link>
      <div className="adm-header__user">
        <LanguageToggle />
        <span
          className="adm-header__name"
          title={user?.roles.map((r) => apiText(`role.${r}`, r)).join(', ')}
        >
          {user?.displayName}
        </span>
        <Link to="/admin/account/security" className="adm-link">
          {t('header.security')}
        </Link>
        <button type="button" className="adm-btn" onClick={() => void logout()}>
          {t('header.signOut')}
        </button>
      </div>
    </header>
  );
}
