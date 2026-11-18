/**
 * Admin layout entry point. The backoffice already has a completed layout (sidebar, header, responsive
 * drawer) from Part 04; it is re-exported here rather than re-implemented, so there is ONE admin layout and it
 * stays visually unchanged. It is deliberately independent of PublicLayout (no shared header, no `.ds-root`).
 * Migrating the admin onto design-system tokens is a separate, approval-gated step.
 */
export { AdminLayout } from '../../components/admin/AdminLayout';
