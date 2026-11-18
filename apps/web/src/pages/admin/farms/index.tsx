import { ModuleUnavailable } from '../../../components/admin';
import { useAdminI18n } from '../../../components/admin/i18n';

export default function Page() {
  const { t } = useAdminI18n();
  return (
    <ModuleUnavailable
      title={t('nav.farms')}
      permission="farms.read"
      note={t('module.farmsNote')}
    />
  );
}
