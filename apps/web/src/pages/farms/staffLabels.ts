import type { FarmPermission } from '@farmplus/shared-types';
import { humanize } from '@farmplus/shared-utils';
import farms from '../../i18n/messages/farms';
import type { FarmsKey, FarmsT } from './labels';

const has = (key: string): key is FarmsKey => key in farms.en;

/** A farm permission in plain words of the current language (`perm.<key>` in the catalog). */
export function permissionLabel(t: FarmsT, permission: FarmPermission): string {
  const key = `perm.${permission}`;
  return has(key) ? t(key) : humanize(permission.replace('.', ' '));
}
