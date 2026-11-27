import { useAdminI18n } from './i18n';
import { PermissionGuard } from './PermissionGuard';

/**
 * Honest placeholder for admin areas whose backend module has not been built yet. It shows no data and
 * offers no actions: financial and marketplace changes must go through their own audited modules,
 * never ad-hoc admin writes.
 */
export function ModuleUnavailable({
  title,
  permission,
  note,
}: {
  title: string;
  permission: string;
  note: string;
}) {
  const { t, label } = useAdminI18n();
  return (
    <PermissionGuard permission={permission} fallback={null}>
      <h1>{title}</h1>
      <div className="adm-card">
        <p>
          <strong>{t('module.unavailable')}</strong>
        </p>
        <p className="adm-muted">{note}</p>
        <p className="adm-muted">
          {t('module.requiredPermission')} {label('perm', permission, permission)}{' '}
          <small>
            (<code>{permission}</code>)
          </small>
        </p>
      </div>
    </PermissionGuard>
  );
}
