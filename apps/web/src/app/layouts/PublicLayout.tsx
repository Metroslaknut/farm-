import { Outlet } from 'react-router-dom';
import { Container } from '../../components/layout';
import { SiteFooter } from '../../components/layout/SiteFooter';
import { SiteHeader } from '../../components/layout/SiteHeader';
import { useT } from '../../i18n';
import { InboxProvider } from '../../lib/inbox';
import '../../styles/index.css';
// Self-hosted fonts (the CSP allows fonts from this origin only): Barlow for Latin, Noto Sans Thai for Thai.
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import '@fontsource/noto-sans-thai/400.css';
import '@fontsource/noto-sans-thai/500.css';
import '@fontsource/noto-sans-thai/600.css';
import '@fontsource/noto-sans-thai/700.css';

/**
 * Layout for public pages built on the design system. It owns the `.ds-root` scope, so tokens and base
 * styles apply here only. The admin backoffice has its own layout (see ./AdminLayout) and never uses this one.
 * Header and footer follow a storefront structure (top bar, search, categories, account and cart; link columns).
 */
export function PublicLayout({ wide = false }: { wide?: boolean }) {
  const t = useT('layout');
  return (
    <InboxProvider>
      <div className="ds-root site-shell">
        <a href="#main" className="ds-skip">
          {t('skipToContent')}
        </a>
        <SiteHeader />
        {/* `wide`: the page lays out its own full-width bands (home); other pages keep the reading width. */}
        <main id="main" tabIndex={-1} className={wide ? 'site-main-wide' : 'ds-main'}>
          {wide ? (
            <Outlet />
          ) : (
            <Container>
              <Outlet />
            </Container>
          )}
        </main>
        <SiteFooter />
      </div>
    </InboxProvider>
  );
}
