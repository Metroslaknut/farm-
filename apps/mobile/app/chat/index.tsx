import { RequireAuth } from '@/auth/RequireAuth';
import { PlaceholderScreen } from '@/components/ui';
import { useT } from '@/i18n';

export default function ChatsScreen() {
  const t = useT('common');
  return (
    <RequireAuth>
      <PlaceholderScreen
        title={t('placeholder.chats.title')}
        description={t('placeholder.chats.description')}
      />
    </RequireAuth>
  );
}
