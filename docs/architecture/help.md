# Help centre

Public at `/help` (no sign-in) and `/help/:slug`. Code: `apps/web/src/help/` (content system) and
`apps/web/src/pages/help/` (pages, own lazy chunk), API `services/api/src/modules/help/`.

## Content: one source

Articles are Markdown files with frontmatter: `apps/web/src/help/content/{th,en}/<slug>.md`, the same slug in both
languages. They are the single source for the help centre, the guided tours' "read more" links and the assistant's
knowledge (later PRs) — change an article once and every place follows. Reviewed in PRs like code.

- **Syntax**: a small, fixed subset documented at the top of `src/help/parse.ts` (numbered steps each with one
  `![alt](img:<id>)` picture, `## ` headings, `- ` bullets, `:::trouble|note|warning <title> … :::` boxes, `**bold**`,
  `[text](/route)` and `[text](help:slug)`). It is parsed into data and rendered as React elements, never as HTML:
  no Markdown library is used and content cannot inject markup. External links are refused.
- **Frontmatter**: `slug`, `title`, `summary`, `audience` (guest · member · farm_owner · seller · staff), `category`
  (getting-started first), `relatedRoutes` (pages the article is about), `keywords` (what people type, e.g.
  "ไม่ได้รับอีเมล"), `order`, `updatedAt`, optional `goTo` ("go to this page") and `availability: messaging-pending`
  (the article needs e-mail/SMS delivery, which is not switched on yet — the page shows a notice).
- **Checked by `apps/web/test/help-content.test.ts`**: both languages for every article, the same steps / picture ids /
  settings in both, every `help:` link resolves, every route link and `goTo` is in the list of real pages, every
  picture file exists at both widths with a description, and the parser rejects what is not allowed.

Plain language for farmers: one action per step, on-screen labels in "quotes", "รหัสยืนยัน 6 หลัก" not "OTP".
Example data only ("[ตัวอย่าง] ฟาร์มสุขใจ", `@example.com`, 0800000000).

## Search

Client-side (`src/help/search.ts`). Thai has no spaces, so text is split with `Intl.Segmenter('th', { granularity:
'word' })` (a whitespace split where it is missing). Weights: keywords 5, title 3, summary 2, body 1, +10 when the
whole query appears in a keyword or the title.

## Pictures

`apps/web/public/help/img/<slug>/<id>-<locale>-<width>.webp`, widths 375 (phone, shown up to 600 px) and 1280. Never
captured by hand: `pnpm help:screenshots` (Playwright, `e2e/help-screenshots/`) walks the real app on the local stack
(in-memory MongoDB, made-up accounts, verification switched on, e-mail/SMS read from the development console through
`E2E_NOTIFY_LOG`), outlines and numbers the thing to press with an overlay injected only while shooting, and encodes
WebP in the browser (no image library). Re-run it after UI changes and commit the pictures; the manual workflow
**Help screenshots** does the same on CI and uploads them as an artifact. CI itself only checks that the files exist.

## Feedback

"Was this article helpful?" → `POST /api/v1/help/feedback` `{ slug, locale, helpful }`: **public** (allow-listed in
`test/qa/authz-allowlists.ts`), rate limited (`helpFeedback`, 30/hour per client), anonymous — collection
`help_feedback` keeps only two counters per article and language (no user, IP or text). Not audited (no business data).

## Entry points

Footer "Help", the account menu and the farm menu; small "How to" links on sign-in, register, check-email,
verify-phone, forgot-password, the seller page and the farm-owner request page.
