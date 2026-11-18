import { useAdminI18n } from './i18n';

type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

const TONES: Record<string, Tone> = {
  // account
  active: 'success',
  pending_verification: 'warning',
  suspended: 'danger',
  deactivated: 'neutral',
  // registration
  PENDING: 'warning',
  UNDER_REVIEW: 'info',
  APPROVED: 'success',
  REJECTED: 'danger',
  SUSPENDED: 'danger',
  // identity / seller / subscription
  verified: 'success',
  pending: 'warning',
  rejected: 'danger',
  unverified: 'neutral',
  none: 'neutral',
  past_due: 'warning',
  cancelled: 'neutral',
  expired: 'neutral',
};

/** Status is always conveyed by text as well as colour. The label comes from the `status.*` key map. */
export function StatusBadge({ status, tone }: { status: string; tone?: Tone }) {
  const { status: statusLabel } = useAdminI18n();
  return (
    <span className={`adm-badge adm-badge--${tone ?? TONES[status] ?? 'neutral'}`}>
      {statusLabel(status)}
    </span>
  );
}
