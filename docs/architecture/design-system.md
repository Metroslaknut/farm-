# Web design system (Part 05)

## Where things live (`apps/web/src/`)

| Path                                                      | Contents                                                                                                                      |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `styles/tokens.css`                                       | **Single source of truth** for colour, type, spacing, radius, elevation, z-index, motion                                      |
| `styles/base.css` · `ui.css` · `layout.css` · `index.css` | Base element styles, component styles, layout styles (tokens only)                                                            |
| `themes/`                                                 | `breakpoints.ts`, `theme-store.ts` (preference + persistence + OS following)                                                  |
| `hooks/useTheme.ts` · `useMediaQuery.ts`                  | React bindings (`useSyncExternalStore`)                                                                                       |
| `components/ui/`                                          | Button, LinkButton, TextField, Textarea, Select, Checkbox, FormField, Card, Badge, Alert, Modal, DropdownMenu, Table, Spinner |
| `components/layout/`                                      | Container, Header (responsive nav), Footer, ThemeToggle                                                                       |
| `app/layouts/`                                            | `PublicLayout` (design system) and `AdminLayout` (re-export of the Part 04 layout)                                            |
| `pages/design-system/`                                    | Minimal preview page (`/design-system`)                                                                                       |

## Theming

- Every colour is declared once as `light-dark(<light>, <dark>)`; the element's `color-scheme` picks the value.
  Preference `system` follows the OS live; `light`/`dark` set `<html data-theme>` and force it. Choice persists in
  `localStorage` (`farmplus.theme`); an inline script in `index.html` applies it before first paint (no flash).
  Blocked/unavailable storage is tolerated (choice still applies for the page view).
- Use: `const { preference, resolved, setPreference } = useTheme()` or drop in `<ThemeToggle />`.
- **Scope:** tokens and base styles apply only inside `.ds-root` (rendered by `PublicLayout`). They never touch
  `:root`/`body`, so pages built before the design system are not restyled (enforced by a test).
- **Contrast** (WCAG 2.1 AA: 4.5:1 text, 3:1 UI boundaries/focus) is asserted for 22 token pairs × both themes in
  `test/design-tokens.test.ts`, and measured again in a real browser for buttons/nav in both themes.
- To add a colour: add ONE `light-dark()` line in `tokens.css`, add its pairs to the test. Components must use `var(--ds-*)`
  only — hard-coded colours, `!important` (except reduced-motion) and global selectors fail the tests.

## Breakpoints

`sm 640 · md 768 · lg 1024 · xl 1280` (`themes/breakpoints.ts`; a test fails if any stylesheet uses another width).
Mobile-first: `< 768` single column with a collapsible menu (button has `aria-expanded`/`aria-controls`, Escape closes and
returns focus); `≥ 768` horizontal navigation; `≥ 640` two-column grids; `≥ 1024` three-column grids and wider gutters.
Touch targets grow to 44px on coarse pointers.

## Accessibility built in

Visible 3px focus ring on everything interactive; skip link; labelled landmarks; `FormField` wires label ↔ hint ↔ error
(`aria-describedby`, `aria-invalid`, required); `Modal` uses native `<dialog>.showModal()` (focus trap, Escape, focus return, inert
background) plus backdrop click and a labelled close button; `DropdownMenu` follows the WAI-ARIA menu-button pattern
(arrows/Home/End, skips disabled, Escape, outside click); `Table` has a required caption, `scope`, `aria-sort`, and a
keyboard-focusable scroll region; status is never colour-only; `prefers-reduced-motion` honoured.

## No duplicated implementations

`buttonClass()` builds button classes for both `Button` and `LinkButton`; `FormField` is the only label/error wiring;
`DropdownMenu`/`Modal`/`Table` exist once. The admin layout is **re-exported**, not copied.

## Existing UI was not redesigned

The public home page (`/`) and the whole admin backoffice (Part 04, `components/admin/`, `pages/admin/`) are untouched.
Verified by byte-identical source hashes and pixel-identical screenshots of `/` and `/admin/login` (desktop + mobile)
before/after — including with Dark selected. The admin has its own `adm-` styles with its own (duplicate) tokens and
its own `StatusBadge`/`AdminDataTable`/`ConfirmActionDialog`. **Proposed follow-up (needs approval, will change visuals
slightly):** migrate the admin onto `--ds-*` tokens and the shared primitives, then delete the duplicates.

## Preview page

`/design-system` is on in `pnpm dev:web`; in other builds set `VITE_ENABLE_DESIGN_PREVIEW=true`. It is an internal page
(tokens, every component and state), not a business page.

## Limitations

- `light-dark()` / `color-mix()` need Chrome 123+/Safari 17.5+/Firefox 120+ (2024 browsers). Older browsers lose theming.
- jsdom has no `<dialog>` modal or layout engine: unit tests cover logic/ARIA; real focus-trap, layout and breakpoints
  were verified with a scripted Chrome run (see report), which is not part of CI.
- No screen-reader or Firefox/Safari manual pass was done. No Storybook/visual-regression pipeline.
- Thai typography uses the system stack (`Noto Sans Thai`/`Sarabun` if installed); no web fonts are bundled.
