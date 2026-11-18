import { beforeEach } from 'vitest';
import { setLocale } from '../src/i18n/locale';

// Tests run in English unless they switch: most assertions are written against English labels.
// Also set now (not only before each test) for expectations computed while a test file is collected.
// A test for Thai output calls setLocale('th') itself.
setLocale('en');
beforeEach(() => setLocale('en'));
