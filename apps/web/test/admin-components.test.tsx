import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminDataTable } from '../src/components/admin/AdminDataTable';
import { ConfirmActionDialog } from '../src/components/admin/ConfirmActionDialog';
import { StatusBadge } from '../src/components/admin/StatusBadge';
import { productReasonSchema } from '@farmplus/validation';

describe('ConfirmActionDialog', () => {
  const setup = (onConfirm = vi.fn().mockResolvedValue(undefined), requireReason = true) => {
    const onClose = vi.fn();
    render(
      <ConfirmActionDialog
        open
        title="Suspend"
        confirmLabel="Suspend now"
        requireReason={requireReason}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );
    return { onConfirm, onClose };
  };

  it('will not confirm until a reason is given, then sends it trimmed', async () => {
    const { onConfirm, onClose } = setup();
    const button = screen.getByRole('button', { name: 'Suspend now' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText(/Reason/), '  Fraud report  ');
    expect(button.disabled).toBe(false);
    await userEvent.click(button);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('Fraud report', ''));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('keeps the dialog open and shows the server error when the action fails', async () => {
    const { onClose } = setup(
      vi
        .fn()
        .mockRejectedValue(
          new Error('You cannot manage an account with greater privileges than yours'),
        ),
    );
    await userEvent.type(screen.getByLabelText(/Reason/), 'because');
    await userEvent.click(screen.getByRole('button', { name: 'Suspend now' }));
    expect((await screen.findByRole('alert')).textContent).toContain('greater privileges');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('can be cancelled without calling the action', async () => {
    const { onConfirm, onClose } = setup(undefined, false);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('AdminDataTable', () => {
  type Row = { id: string; name: string };
  const base = {
    caption: 'People',
    columns: [{ key: 'name', header: 'Name', sortKey: 'name', cell: (r: Row) => r.name }],
    rowKey: (r: Row) => r.id,
    total: 45,
    page: 2,
    pageSize: 20,
    onPageChange: () => undefined,
    loading: false,
  };

  it('renders rows, range and pagination controls', () => {
    const onPageChange = vi.fn();
    render(
      <AdminDataTable
        {...base}
        rows={[{ id: '1', name: 'Somchai' }]}
        onPageChange={onPageChange}
      />,
    );
    expect(screen.getByText('Somchai')).toBeTruthy();
    expect(screen.getByText('21–40 of 45')).toBeTruthy();
    expect(screen.getByText('Page 2 / 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it('disables paging at the edges', () => {
    render(<AdminDataTable {...base} page={1} total={5} rows={[{ id: '1', name: 'A' }]} />);
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('toggles sort direction and exposes aria-sort', () => {
    const onSortChange = vi.fn();
    render(
      <AdminDataTable
        {...base}
        rows={[{ id: '1', name: 'A' }]}
        sort={{ by: 'name', order: 'asc' }}
        onSortChange={onSortChange}
      />,
    );
    expect(screen.getByRole('columnheader', { name: /Name/ }).getAttribute('aria-sort')).toBe(
      'ascending',
    );
    fireEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(onSortChange).toHaveBeenCalledWith({ by: 'name', order: 'desc' });
  });

  it('shows loading, empty and error states', () => {
    const { rerender } = render(<AdminDataTable {...base} rows={undefined} loading />);
    expect(screen.getByRole('status').textContent).toContain('Loading');
    rerender(<AdminDataTable {...base} rows={[]} total={0} emptyMessage="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeTruthy();
    const onRetry = vi.fn();
    rerender(<AdminDataTable {...base} rows={undefined} error="Boom" onRetry={onRetry} />);
    expect(screen.getByRole('alert').textContent).toContain('Boom');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('StatusBadge', () => {
  it('always shows the status as text, with a tone class', () => {
    render(
      <>
        <StatusBadge status="UNDER_REVIEW" />
        <StatusBadge status="suspended" />
      </>,
    );
    expect(screen.getByText('under review').className).toContain('info');
    expect(screen.getByText('suspended').className).toContain('danger');
  });
});

describe('ConfirmActionDialog with the API reason schema (staging QA 2026-11-25, task 4)', () => {
  it('checks the reason with the schema before sending and shows its message', async () => {
    const onConfirm = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(
      <ConfirmActionDialog
        open
        title="Reject product"
        confirmLabel="Reject"
        requireReason
        reasonSchema={productReasonSchema}
        onConfirm={onConfirm}
        onClose={() => undefined}
      />,
    );
    const reason = screen.getByRole('textbox');
    const reject = screen.getByRole('button', { name: 'Reject' });
    expect((reject as HTMLButtonElement).disabled).toBe(true); // empty reason
    fireEvent.change(reason, { target: { value: 'x'.repeat(320) } }); // longer than the API accepts (300)
    await user.click(reject);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBeTruthy();
    expect(reason.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(reason, { target: { value: 'Photos do not match the product' } });
    await user.click(reject);
    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith('Photos do not match the product', ''),
    );
  });
});
