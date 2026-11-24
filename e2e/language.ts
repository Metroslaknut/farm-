/**
 * Browser storage for e2e pages: the FARM+ UI language (`farmplus.locale`), and guided tours not starting on their own
 * (`farmplus.tours.off`) so a tour card never covers what a spec is testing. The guided-tour spec passes
 * `{ tours: true }` to see tours as a first-time visitor would.
 */
export function languageState(locale: 'th' | 'en', options: { tours?: boolean } = {}) {
  const origin = `http://localhost:${process.env['E2E_WEB_PORT'] ?? '5310'}`;
  return {
    cookies: [],
    origins: [
      {
        origin,
        localStorage: [
          { name: 'farmplus.locale', value: locale },
          ...(options.tours ? [] : [{ name: 'farmplus.tours.off', value: '1' }]),
        ],
      },
    ],
  };
}
