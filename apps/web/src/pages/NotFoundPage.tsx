import { Link } from 'react-router-dom';
import { Card } from '../components/ui';
import { useT } from '../i18n';

/** Any URL no area handles: says so (instead of showing the home page) and links back home. */
export default function NotFoundPage() {
  const t = useT('layout');
  return (
    <Card title={t('notFound.title')} headingLevel={1}>
      <p>{t('notFound.body')}</p>
      <p>
        <Link to="/">{t('notFound.home')}</Link>
      </p>
    </Card>
  );
}
