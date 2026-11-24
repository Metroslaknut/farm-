# Guided tours

Step-by-step tips shown the first time someone opens a page. Code: `apps/web/src/tours/` (own component, no library),
API `services/api/src/modules/tours/`. Text: the `tours` catalog (`apps/web/src/i18n/messages/tours.ts`, TH + EN).

## Adding a tour

1. Mark each element a step points at with `data-tour="<anchor>"` (lower-case words and hyphens). That attribute is
   the only change a page needs: no layout or CSS changes.
2. Add a definition to `src/tours/registry.ts`: `id`, `version`, `routes` (react-router patterns), optional
   `startPath` (for "start again" from /help — only routes without parameters), `audience` (`guest` · `member` · `any`),
   optional `when(ctx)` (permissions through the existing RBAC: `ctx.can('…')`), and 3–7 `steps`
   (`anchor`, `titleKey`, `bodyKey`, `placement`, `helpSlug` → `/help/<slug>`, `optional`, `observeOnly`).
3. Add the step texts (`<id>.<n>.title|body`, ≤ 2 lines) and `name.<id>` in Thai and English.

`apps/web/test/tours.test.tsx` fails when a key is missing in either language, a `helpSlug` is not a real article, an
id/anchor has the wrong form or a tour has fewer than 3 or more than 7 steps.

## Behaviour

- Starts by itself the **first time** a page with a tour is opened, once the page has its first step's element and no
  other dialog is open; one tour at a time. Steps whose element is not on the page (no permission, no data yet) are
  left out.
- The person moves with "Next" / "Back"; nothing advances by itself and nothing on the page is pressed for them.
  "Skip", Esc and leaving the page end it (saved as `skipped` with the last step seen); "Done" → `completed`;
  "Don't show these tips again" → `dismissed_forever`.
- The page is **not locked**: the spotlight only dims (it lets clicks through). `observeOnly` steps block the pointed
  element only.
- Accessibility: the card is a non-modal dialog labelled by its title; focus moves into it and back where it was when
  the tour ends; each step is announced (`aria-live`); keyboard only works; `prefers-reduced-motion` turns off
  movement and smooth scrolling.
- Phones (< 768 px): the card is a bottom sheet, and the page scrolls so the pointed element stays above it.
- "Show this page's tips again" in the account menus (site header, farm shell); every startable tour is listed on
  /help ("Step-by-step tips"), which also serves guests.
- The overlay is its own lazy chunk; pages without a tour never load it.

## Remembering

- **Signed in**: on the server, `GET /api/v1/me/tours` and `PUT /api/v1/me/tours/:tourId`
  `{ version, status, lastStep }` — collection `user_tour_progress`, unique `(userId, tourId)`. The user always comes
  from the token (no user field exists), so nobody can read or change someone else's. Kept on the server because
  refresh tokens live per tab: browser storage alone would show the tour again in every new tab.
- **Guests**: this browser's localStorage (`farmplus.tours`), wrapped in try/catch — when blocked, the tour simply shows
  again.
- A tour is shown again when its `version` goes up, except to people who chose "don't show again".
- **Not audited**: a personal display preference, not business data.
- **Stats**: no event endpoint — counted from `user_tour_progress` (status per tour, `lastStep` for where people leave;
  index `(tourId, status)`). Guests are not counted.

## Tests and automation

`localStorage['farmplus.tours.off'] = '1'` stops tours from starting on their own (manual start still works). e2e sets
it by default through `e2e/language.ts` (`languageState(locale)`) so a tour card never covers what a spec checks; the
tour spec passes `{ tours: true }`. The help screenshots run with it on too.

Release: the new collection needs no data migration; create its indexes with
`pnpm --filter @farmplus/api db indexes --apply --confirm-db farmplus`.
