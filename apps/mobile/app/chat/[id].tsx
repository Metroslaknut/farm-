import { useLocalSearchParams } from 'expo-router';
import { RequireAuth } from '@/auth/RequireAuth';
import { PlaceholderScreen } from '@/components/ui';
import { useT } from '@/i18n';

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT('common');
  return (
    <RequireAuth>
      <PlaceholderScreen
        title={t('placeholder.chat.title')}
        description={t('placeholder.chat.description')}
        params={{ id }}
      />
    </RequireAuth>
  );
}
