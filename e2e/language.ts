/** Browser storage that selects the FARM+ UI language (the web app reads `farmplus.locale` on load). */
export function languageState(locale: 'th' | 'en') {
  const origin = `http://localhost:${process.env['E2E_WEB_PORT'] ?? '5310'}`;
  return {
    cookies: [],
    origins: [{ origin, localStorage: [{ name: 'farmplus.locale', value: locale }] }],
  };
}
