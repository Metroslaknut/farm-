import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { setLocale } from '../src/i18n/locale';
import { forgetRecent } from '../src/lib/shared';

// Tests run in English unless they switch: most assertions are written against English labels.
// A test for Thai output calls setLocale('th') itself.
beforeEach(() => setLocale('en'));

// jsdom has no <dialog> modal support: emulate open/close so the component logic can be exercised.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
}

afterEach(() => {
  cleanup();
  // Results reused for a few seconds by `sharedRecent` must not leak into the next test's mocked API.
  forgetRecent();
});
