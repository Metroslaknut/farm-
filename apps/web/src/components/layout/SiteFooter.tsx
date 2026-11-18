import { Link } from 'react-router-dom';
import { useT, type Translate } from '../../i18n';
import { Icon } from './Icon';
import './site.css';

type Key = Parameters<Translate<'layout'>>[0];

/** Link columns as catalog keys, resolved at render time so they follow the language switch. */
const COLUMNS: { title: Key; links: { to: string; label: Key }[] }[] = [
  {
    title: 'footer.colShop',
    links: [
      { to: '/shop', label: 'footer.shop' },
      { to: '/market', label: 'footer.market' },
      { to: '/market/favorites', label: 'footer.favorites' },
      { to: '/shop/cart', label: 'footer.cart' },
    ],
  },
  {
    title: 'footer.colAccount',
    links: [
      { to: '/farms', label: 'footer.farms' },
      { to: '/market/orders', label: 'footer.orders' },
      { to: '/market/offers', label: 'footer.offers' },
      { to: '/market/wallet', label: 'footer.wallet' },
    ],
  },
  {
    title: 'footer.colSellers',
    links: [
      { to: '/market/sell', label: 'footer.sellAnimals' },
      { to: '/shop/sell', label: 'footer.sellProducts' },
      { to: '/farms/new', label: 'footer.newFarm' },
    ],
  },
  {
    title: 'footer.colCommunity',
    links: [
      { to: '/community', label: 'footer.feed' },
      { to: '/videos', label: 'footer.videos' },
      { to: '/live', label: 'footer.live' },
      { to: '/messages', label: 'footer.messages' },
    ],
  },
];

/** Store-style footer: about blurb, link columns (only routes that exist) and a bottom bar. */
export function SiteFooter() {
  const t = useT('layout');
  return (
    <footer className="site-footer">
      <div className="site-container">
        <div className="site-footer__grid">
          <section className="site-footer__about" aria-labelledby="site-footer-about">
            <h2 id="site-footer-about" className="site-logo">
              <span className="site-logo__mark" aria-hidden="true">
                <Icon name="sprout" size={22} />
              </span>
              <span>
                FARM<span className="site-logo__plus">+</span>
              </span>
            </h2>
            <p>{t('footer.about')}</p>
            <p className="site-footer__muted">{t('footer.help')}</p>
          </section>
          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={t(col.title)} className="site-footer__col">
              <h2>{t(col.title)}</h2>
              <ul>
                {col.links.map((l) => (
                  <li key={l.to}>
                    <Link to={l.to}>{t(l.label)}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="site-footer__bottom">
          <span>{t('footer.copyright', { year: new Date().getFullYear() })}</span>
          <span className="site-footer__muted">{t('footer.currency')}</span>
        </div>
      </div>
    </footer>
  );
}
