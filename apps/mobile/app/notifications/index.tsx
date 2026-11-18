import { RequireAuth } from '@/auth/RequireAuth';
import { PlaceholderScreen } from '@/components/ui';
import { useT } from '@/i18n';

export default function NotificationsScreen() {
  const t = useT('common');
  return (
    <RequireAuth>
      <PlaceholderScreen
        title={t('placeholder.notifications.title')}
        description={t('placeholder.notifications.description')}
      />
    </RequireAuth>
  );
}
