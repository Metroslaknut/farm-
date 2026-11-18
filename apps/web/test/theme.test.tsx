import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeToggle } from '../src/components/layout/ThemeToggle';
import { useTheme } from '../src/hooks/useTheme';
import { THEME_STORAGE_KEY, themeStore } from '../src/themes';

type Listener = (e: { matches: boolean }) => void;
let osDark = false;
const listeners = new Set<Listener>();

/** In-memory Storage: Node 26 shadows jsdom's localStorage, so tests provide their own. */
function makeStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
}

beforeEach(() => {
  osDark = false;
  listeners.clear();
  vi.stubGlobal('localStorage', makeStorage());
  document.documentElement.removeAttribute('data-theme');
  themeStore.reset();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query.includes('prefers-color-scheme: dark') ? osDark : false;
    },
    media: query,
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  }));
});
afterEach(() => vi.unstubAllGlobals());

const Probe = () => {
  const { preference, resolved } = useTheme();
  return (
    <p data-testid="t">
      {preference}/{resolved}
    </p>
  );
};
const attr = () => document.documentElement.getAttribute('data-theme');

describe('useTheme', () => {
  it('defaults to following the system (no data-theme attribute)', () => {
    render(<Probe />);
    expect(screen.getByTestId('t').textContent).toBe('system/light');
    expect(attr()).toBeNull();
  });

  it('resolves "system" from the OS and updates live when the OS changes', () => {
    osDark = true;
    render(<Probe />);
    expect(screen.getByTestId('t').textContent).toBe('system/dark');
    act(() => {
      osDark = false;
      listeners.forEach((l) => l({ matches: false }));
    });
    expect(screen.getByTestId('t').textContent).toBe('system/light');
  });

  it('a user choice applies data-theme, persists, and survives a reload', async () => {
    const { unmount } = render(
      <>
        <Probe />
        <ThemeToggle />
      </>,
    );
    await userEvent.click(screen.getByLabelText('Dark'));
    expect(screen.getByTestId('t').textContent).toBe('dark/dark');
    expect(attr()).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    unmount();

    themeStore.reset(); // simulate a fresh page load
    render(<Probe />);
    expect(screen.getByTestId('t').textContent).toBe('dark/dark');
    expect(attr()).toBe('dark');
  });

  it('an explicit choice wins over the OS setting', async () => {
    osDark = true;
    render(
      <>
        <Probe />
        <ThemeToggle />
      </>,
    );
    await userEvent.click(screen.getByLabelText('Light'));
    expect(screen.getByTestId('t').textContent).toBe('light/light');
    act(() => listeners.forEach((l) => l({ matches: true })));
    expect(screen.getByTestId('t').textContent).toBe('light/light');
  });

  it('choosing System clears the override and the stored value', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(
      <>
        <Probe />
        <ThemeToggle />
      </>,
    );
    await userEvent.click(screen.getByLabelText('System'));
    expect(attr()).toBeNull();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('ignores corrupt stored values and tolerates blocked storage', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    render(<Probe />);
    expect(screen.getByTestId('t').textContent).toBe('system/light');

    themeStore.reset();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => act(() => themeStore.setPreference('dark'))).not.toThrow();
    expect(attr()).toBe('dark'); // still applied for this view
    vi.restoreAllMocks();
  });

  it('the toggle is a labelled radio group reflecting the current choice', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('group', { name: 'Colour theme' })).toBeTruthy();
    expect((screen.getByLabelText('System') as HTMLInputElement).checked).toBe(true);
  });
});
