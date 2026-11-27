import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAnimalSchema, createBreedingSchema, createWeightSchema } from '@farmplus/validation';

/** Staging QA 2026-11-23 items #16–#19 and #21 (task 7 of the 25 Nov brief). */
const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request } }));

import { Textarea, TextField } from '../src/components/ui';
import { installFocusFirstInvalid } from '../src/lib/focusFirstInvalid';
import { installPageTitles } from '../src/lib/pageTitle';
import { maxLengthOf } from '../src/lib/schemaLimits';
import { RecordForm } from '../src/pages/farms/records/RecordForm';
import { KINDS } from '../src/pages/farms/records/recordConfigs';

let off: (() => void)[] = [];
beforeAll(() => {
  // jsdom: run animation frames soon.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
});
beforeEach(() => request.mockReset());
afterEach(() => {
  off.forEach((f) => f());
  off = [];
});

describe('#16 focus moves to the first field with a message after a failed submit', () => {
  function Form() {
    const [error, setError] = useState<string>();
    return (
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError('Enter a name');
        }}
      >
        <TextField label="Note" />
        <TextField label="Name" error={error} />
        <button type="submit">Save</button>
      </form>
    );
  }
  it('any form, no code in the form itself', async () => {
    off.push(installFocusFirstInvalid());
    const user = userEvent.setup();
    render(<Form />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Name')));
  });
});

describe('#17 page title follows the main heading', () => {
  it('"<heading> · FARM+", updated when the page changes', async () => {
    window.history.pushState({}, '', '/farms/x');
    off.push(installPageTitles());
    const { rerender } = render(
      <main>
        <h1>Weights</h1>
      </main>,
    );
    await waitFor(() => expect(document.title).toBe('Weights · FARM+'));
    rerender(
      <main>
        <h1>สุขภาพ</h1>
      </main>,
    );
    await waitFor(() => expect(document.title).toBe('สุขภาพ · FARM+'));
    window.history.pushState({}, '', '/');
  });
});

describe('#18 length limits show while typing', () => {
  it('reads the limits from the shared schemas (also nested fields)', () => {
    expect(maxLengthOf(createAnimalSchema, 'notes')).toBe(2000);
    expect(maxLengthOf(createWeightSchema, 'notes')).toBe(1000);
    expect(maxLengthOf(createBreedingSchema, 'sireExternal.name')).toBeGreaterThan(0);
    expect(maxLengthOf(createWeightSchema, 'nope')).toBeUndefined();
  });
  it('a textarea with a limit shows how much is used and stops at the limit', () => {
    render(<Textarea label="Notes" maxLength={10} value="hello" onChange={() => undefined} />);
    expect(screen.getByLabelText('Notes').getAttribute('maxlength')).toBe('10');
    expect(screen.getByText('5/10')).toBeTruthy();
  });
});

describe('#21 breeding: a sire on the farm and an outside sire together', () => {
  it('the message shows on the outside-sire field instead of "Save" doing nothing', async () => {
    off.push(installFocusFirstInvalid());
    const DAM = 'd'.repeat(24);
    const SIRE = 's'.repeat(24);
    request.mockImplementation(async (_m: string, path: string) => {
      if (String(path).endsWith('/animals'))
        return {
          items: [
            {
              id: DAM,
              animalCode: 'D-1',
              sex: 'female',
              currentStatus: 'active',
              animalTypeId: 't',
            },
            {
              id: SIRE,
              animalCode: 'S-1',
              sex: 'male',
              currentStatus: 'active',
              animalTypeId: 't',
            },
          ],
          page: 1,
          pageSize: 100,
          total: 2,
        };
      if (path === '/animal-types') return { animalTypes: [] };
      return { items: [], page: 1, pageSize: 20, total: 0 };
    });
    const user = userEvent.setup();
    render(
      <RecordForm
        config={KINDS.breeding}
        farmId="f1"
        onDone={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const dam = await screen.findByLabelText(/^Dam/);
    await waitFor(() => expect(within(dam).getAllByRole('option').length).toBeGreaterThan(1));
    await user.selectOptions(dam, DAM);
    await user.selectOptions(screen.getByLabelText(/^Sire on this farm/), SIRE);
    await user.type(screen.getByLabelText(/^Outside sire — name/), 'AI straw 7');
    await user.click(screen.getByRole('button', { name: 'Save breeding record' }));
    const outside = screen.getByLabelText(/^Outside sire — name/);
    await waitFor(() => expect(outside.getAttribute('aria-invalid')).toBe('true'));
    expect(screen.getByText(/not both/)).toBeTruthy();
    expect(request.mock.calls.some((c) => c[0] === 'POST')).toBe(false);
    // Focus lands on the first field with a message (here the breeding date, left empty, comes first).
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-invalid')).toBe('true'));
  });
});
