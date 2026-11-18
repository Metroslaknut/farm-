import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Header } from '../src/components/layout/Header';
import { setLocale } from '../src/i18n';
import {
  Alert,
  Badge,
  Button,
  buttonClass,
  Card,
  Checkbox,
  PasswordField,
  DropdownMenu,
  LinkButton,
  Modal,
  Select,
  Table,
  TextField,
} from '../src/components/ui';

describe('Button', () => {
  it('defaults to type=button (never submits a form by accident) and uses shared classes', () => {
    render(
      <Button variant="primary" size="lg">
        Go
      </Button>,
    );
    const b = screen.getByRole('button', { name: 'Go' });
    expect(b.getAttribute('type')).toBe('button');
    expect(b.className).toContain('ds-btn--primary');
    expect(b.className).toContain('ds-btn--lg');
  });
  it('loading disables clicks and announces busy', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const b = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.getAttribute('aria-busy')).toBe('true');
    await userEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });
  it('LinkButton is a real link built from the same class helper as Button', () => {
    render(
      <LinkButton href="/x" variant="primary">
        Open
      </LinkButton>,
    );
    const a = screen.getByRole('link', { name: 'Open' });
    expect(a.className).toBe(buttonClass({ variant: 'primary' }));
  });
});

describe('form fields', () => {
  it('associates label, hint and error with the control', () => {
    render(<TextField label="Email" hint="We never share it" error="Invalid email" required />);
    const input = screen.getByLabelText(/Email/) as HTMLInputElement;
    expect(input.required).toBe(true);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const described = input
      .getAttribute('aria-describedby')!
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual(['We never share it', 'Invalid email']);
  });
  it('is not marked invalid without an error', () => {
    render(<TextField label="Name" />);
    expect(screen.getByLabelText('Name').getAttribute('aria-invalid')).toBeNull();
  });
  it('Select and Checkbox are labelled and operable by keyboard', async () => {
    const onChange = vi.fn();
    render(
      <>
        <Select label="Type" onChange={onChange}>
          <option value="a">A</option>
          <option value="b">B</option>
        </Select>
        <Checkbox label="Agree" />
      </>,
    );
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'b');
    expect(onChange).toHaveBeenCalled();
    screen.getByLabelText('Agree').focus();
    await userEvent.keyboard(' ');
    expect((screen.getByLabelText('Agree') as HTMLInputElement).checked).toBe(true);
  });
  it('generates unique ids for repeated fields', () => {
    render(
      <>
        <TextField label="A" />
        <TextField label="B" />
      </>,
    );
    expect(screen.getByLabelText('A').id).not.toBe(screen.getByLabelText('B').id);
  });
});

describe('Card, Badge, Alert', () => {
  it('Card renders the requested heading level', () => {
    render(
      <Card title="Hello" headingLevel={2}>
        Body
      </Card>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Hello' })).toBeTruthy();
  });
  it('Badge shows status as text; danger Alert is an alert, others are status', () => {
    render(
      <>
        <Badge tone="success">Approved</Badge>
        <Alert tone="danger">Bad</Alert>
        <Alert>Info</Alert>
      </>,
    );
    expect(screen.getByText('Approved').className).toContain('ds-badge--success');
    expect(screen.getByRole('alert').textContent).toBe('Bad');
    expect(screen.getByRole('status').textContent).toBe('Info');
  });
});

describe('Modal', () => {
  it('is labelled by its title and opens/closes with the open prop', () => {
    const { rerender } = render(
      <Modal open={false} onClose={() => undefined} title="Delete?">
        Body
      </Modal>,
    );
    const dialog = document.querySelector('dialog')!;
    expect(dialog.hasAttribute('open')).toBe(false);
    rerender(
      <Modal open onClose={() => undefined} title="Delete?">
        Body
      </Modal>,
    );
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.getAttribute('aria-labelledby')).toBe(
      screen.getByRole('heading', { name: 'Delete?' }).id,
    );
  });
  it('closes via the labelled close button, Escape (cancel) and an outside click', () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="T" footer={<Button>OK</Button>}>
        <p>Body</p>
      </Modal>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    const dialog = document.querySelector('dialog')!;
    expect(fireEvent(dialog, new Event('cancel', { cancelable: true, bubbles: false }))).toBe(
      false,
    ); // default prevented
    expect(onClose).toHaveBeenCalledTimes(2);
    dialog.getBoundingClientRect = () =>
      ({ left: 10, right: 100, top: 10, bottom: 100 }) as DOMRect;
    fireEvent.click(dialog, { clientX: 5, clientY: 5 }); // backdrop
    expect(onClose).toHaveBeenCalledTimes(3);
    fireEvent.click(dialog, { clientX: 50, clientY: 50 }); // inside the box: stays open
    expect(onClose).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByText('Body')); // content click bubbles with a different target
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

describe('DropdownMenu keyboard behaviour', () => {
  const items = (spy = vi.fn()) => [
    { id: 'a', label: 'Edit', onSelect: () => spy('a') },
    { id: 'b', label: 'Disabled', onSelect: spy, disabled: true },
    { id: 'c', label: 'Delete', onSelect: () => spy('c') },
  ];
  it('exposes menu-button semantics and opens with the keyboard, focusing the first item', async () => {
    render(<DropdownMenu label="Actions" items={items()} />);
    const trigger = screen.getByRole('button', { name: /Actions/ });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    trigger.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu')).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Edit' })),
    );
  });
  it('arrows skip disabled items and wrap; Home/End jump', async () => {
    render(<DropdownMenu label="Actions" items={items()} />);
    await userEvent.click(screen.getByRole('button', { name: /Actions/ }));
    const edit = screen.getByRole('menuitem', { name: 'Edit' });
    const del = screen.getByRole('menuitem', { name: 'Delete' });
    await waitFor(() => expect(document.activeElement).toBe(edit));
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(del);
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(edit);
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(del);
    await userEvent.keyboard('{Home}');
    expect(document.activeElement).toBe(edit);
  });
  it('Escape closes and returns focus to the trigger; selecting runs the action and closes', async () => {
    const spy = vi.fn();
    render(<DropdownMenu label="Actions" items={items(spy)} />);
    const trigger = screen.getByRole('button', { name: /Actions/ });
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(spy).toHaveBeenCalledWith('c');
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it('closes on outside click', async () => {
    render(
      <>
        <DropdownMenu label="Actions" items={items()} />
        <p>outside</p>
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Actions/ }));
    fireEvent.pointerDown(screen.getByText('outside'));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
});

describe('Table', () => {
  const columns = [
    { key: 'n', header: 'Name', sortKey: 'name', cell: (r: { n: string }) => r.n },
    { key: 'x', header: 'Other', cell: () => 'x' },
  ];
  it('has a caption, column headers with scope, and a keyboard-focusable scroll region', () => {
    render(<Table caption="People" columns={columns} rows={[{ n: 'A' }]} rowKey={(r) => r.n} />);
    expect(screen.getByRole('table', { name: 'People' })).toBeTruthy();
    expect(screen.getAllByRole('columnheader')[0]!.getAttribute('scope')).toBe('col');
    expect(screen.getByRole('region', { name: /People/ }).getAttribute('tabindex')).toBe('0');
  });
  it('sort buttons toggle direction and expose aria-sort; empty state is shown', () => {
    const onSort = vi.fn();
    const { rerender } = render(
      <Table
        caption="P"
        columns={columns}
        rows={[]}
        rowKey={(r) => r.n}
        sort={{ by: 'name', order: 'asc' }}
        onSortChange={onSort}
        emptyMessage="No rows"
      />,
    );
    expect(screen.getByText('No rows')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /Name/ }).getAttribute('aria-sort')).toBe(
      'ascending',
    );
    fireEvent.click(screen.getByRole('button', { name: /Name/ }));
    expect(onSort).toHaveBeenCalledWith({ by: 'name', order: 'desc' });
    rerender(
      <Table
        caption="P"
        columns={columns}
        rows={[]}
        rowKey={(r) => r.n}
        sort={{ by: 'name', order: 'desc' }}
        onSortChange={onSort}
      />,
    );
    expect(screen.getByRole('columnheader', { name: /Name/ }).getAttribute('aria-sort')).toBe(
      'descending',
    );
  });
});

describe('responsive Header navigation', () => {
  const setup = () =>
    render(
      <MemoryRouter initialEntries={['/']}>
        <Header
          brand="FARM+"
          items={[
            { to: '/', label: 'Home', end: true },
            { to: '/about', label: 'About' },
          ]}
          actions={<button>act</button>}
        />
      </MemoryRouter>,
    );
  it('menu button controls the nav panel (aria-expanded / aria-controls)', async () => {
    setup();
    const btn = screen.getByRole('button', { name: 'Menu' });
    const panel = document.getElementById(btn.getAttribute('aria-controls')!)!;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(panel.getAttribute('data-open')).toBe('false');
    await userEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(panel.getAttribute('data-open')).toBe('true');
  });
  it('Escape closes the menu and returns focus to the button', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    await userEvent.keyboard('{Escape}');
    const btn = screen.getByRole('button', { name: 'Menu' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(btn);
  });
  it('navigation is a labelled landmark and marks the current page', () => {
    setup();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'About' }).getAttribute('aria-current')).toBeNull();
  });
});

describe('PasswordField show/hide', () => {
  beforeEach(() => setLocale('th'));

  it('starts hidden, toggles with one named button, and keeps the typed value', async () => {
    render(<PasswordField label="Password" defaultValue="s3cret-pass" />);
    const input = screen.getByLabelText('Password') as HTMLInputElement;
    const toggle = screen.getByRole('button', { name: 'แสดงรหัสผ่าน' });
    expect(input.type).toBe('password');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(input.id);
    await userEvent.click(toggle);
    expect(input.type).toBe('text');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(input.value).toBe('s3cret-pass');
    await userEvent.click(toggle);
    expect(input.type).toBe('password');
  });
});

describe('PasswordField in English', () => {
  it('names the toggle without the word "password", so a label search finds only the field', async () => {
    render(<PasswordField label="Password" defaultValue="s3cret-pass" />);
    expect(screen.getAllByLabelText(/password/i)).toHaveLength(1);
    const toggle = screen.getByRole('button', { name: 'Show' });
    expect(toggle.getAttribute('title')).toBe('Show');
    await userEvent.click(toggle);
    expect(toggle.getAttribute('title')).toBe('Hide');
    act(() => setLocale('th'));
    expect(screen.getByRole('button', { name: 'แสดงรหัสผ่าน' }).getAttribute('title')).toBe(
      'ซ่อนรหัสผ่าน',
    );
  });
});
