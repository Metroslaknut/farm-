import { visibleNav } from '../../components/admin/nav';

export { PermissionGuard } from '../../components/admin/PermissionGuard';
export { StateMessage } from '../../components/admin/StateMessage';

export function visibleNavFirst(canAny: (p: readonly string[]) => boolean): string | undefined {
  return visibleNav(canAny)[0]?.items[0]?.path;
}
