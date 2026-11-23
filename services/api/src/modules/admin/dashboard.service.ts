import {
  REGISTRATION_STATUSES,
  type DashboardResponse,
  type RegistrationStatus,
} from '@farmplus/shared-types';
import type { Actor } from '../../context';
import { thaiDayBegins, thaiToday } from '@farmplus/validation';
import { AuditLog, Registration, User } from '../../models';

const DAY = 24 * 60 * 60 * 1000;

/** Each block is computed only if the caller may see it (least privilege on aggregate data too). */
export async function buildDashboard(actor: Actor): Promise<DashboardResponse> {
  const can = (permission: string): boolean => actor.access.permissions.has(permission);
  const now = Date.now();
  const response: DashboardResponse = { generatedAt: new Date(now).toISOString() };

  if (can('users.read')) {
    const [total, active, suspended, pendingVerification, newLast7Days, signups] =
      await Promise.all([
        User.countDocuments(),
        User.countDocuments({ status: 'active' }),
        User.countDocuments({ status: 'suspended' }),
        User.countDocuments({ status: 'pending_verification' }),
        User.countDocuments({ createdAt: { $gte: new Date(now - 7 * DAY) } }),
        User.aggregate<{ _id: string; count: number }>([
          {
            $match: {
              // The last 14 Thai calendar days, from midnight in Bangkok.
              createdAt: { $gte: thaiDayBegins(thaiToday(now - 13 * DAY)) },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Bangkok' },
              },
              count: { $sum: 1 },
            },
          },
        ]),
      ]);
    response.users = { total, active, suspended, pendingVerification, newLast7Days };
    const byDate = new Map(signups.map((s) => [s._id, s.count]));
    response.signupsByDay = Array.from({ length: 14 }, (_, i) => {
      const date = thaiToday(now - (13 - i) * DAY);
      return { date, count: byDate.get(date) ?? 0 };
    });
  }

  if (can('registrations.review')) {
    const rows = await Registration.aggregate<{ _id: RegistrationStatus; count: number }>([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const byStatus = Object.fromEntries(REGISTRATION_STATUSES.map((s) => [s, 0])) as Record<
      RegistrationStatus,
      number
    >;
    for (const row of rows) byStatus[row._id] = row.count;
    response.registrations = { byStatus };
  }

  if (can('audit_logs.read')) {
    response.audit = {
      eventsLast24h: await AuditLog.countDocuments({ createdAt: { $gte: new Date(now - DAY) } }),
    };
  }
  return response;
}
