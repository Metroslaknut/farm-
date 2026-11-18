import { RequireAuth } from '@/auth/RequireAuth';
import { PlaceholderScreen } from '@/components/ui';
import { useT } from '@/i18n';

export default function WalletScreen() {
  const t = useT('common');
  return (
    <RequireAuth>
      <PlaceholderScreen
        title={t('placeholder.wallet.title')}
        description={t('placeholder.wallet.description')}
      />
    </RequireAuth>
  );
}
