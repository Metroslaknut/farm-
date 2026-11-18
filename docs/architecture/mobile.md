# Mobile app (Part 06) — `apps/mobile`

Expo SDK 57 · React Native 0.86 · Expo Router (file-based) · TypeScript. iOS + Android (Expo web is only a dev aid).

## Structure

```
app/                     Expo Router routes (spec layout)
  _layout.tsx            providers, splash gate, root Stack
  (auth)/                sign-in, register (modal group)
  (tabs)/                Home · Videos · Market · My Farm · Profile
  farm/ animal/ videos/ live/ marketplace/ product/ wallet/ chat/ notifications/   detail + feature stubs
  +native-intent.tsx     deep-link allow-list;  +not-found.tsx
src/
  theme/                 palette.ts (only hex values) → theme.ts (semantic roles) → useTheme()
  config/                api-url.ts (pure resolver) · env.ts (EXPO_PUBLIC_* only)
  api/                   client.ts (authenticated, shared) · public.ts · errors.ts
  auth/                  token-storage · session-manager · AuthProvider · RequireAuth
  network/               NetworkProvider (NetInfo) · hooks/useAsync (loading/error/offline)
  components/ui/         Text Button TextField Card StatusBadge Screen StateView OfflineBanner PlaceholderScreen
  lib/                   deep-links.ts · permissions.ts
```

Feature screens are intentionally stubs ("Coming soon" + route params) — no business logic yet.

## Theme (white + red)

All colours live in `src/theme/palette.ts`; components only use semantic roles from `theme.ts` (`primary`, `surface`, `success`, …).
Re-branding = edit the palette. Tests enforce: white background, red brand, neutral-gray secondary surfaces, WCAG AA contrast for every
text pair (3:1 for control outlines), and **no hex colours anywhere else**. `error` is a separate role from brand red and every status
shows icon + text, not colour alone. App is light-only (`userInterfaceStyle: light`).

## API client

One shared `@farmplus/api-client` instance (`src/api/client.ts`): base URL from `config/env.ts`, access token attached from memory, one automatic
refresh + retry on 401. URL resolution (`api-url.ts`): explicit `EXPO_PUBLIC_API_BASE_URL` wins (Android emulator: `localhost`→`10.0.2.2`);
in dev with no value it uses the machine serving the bundle (works on real phones); production **requires** an `https://` URL and never falls
back to localhost — otherwise the app shows a configuration-error screen instead of failing mysteriously. Only `EXPO_PUBLIC_*` variables exist
in the bundle (anyone with the app can read them): a test fails if mobile code references server secrets.
Expo reads env files from `apps/mobile/` (not the repo-root `.env`).

## Authentication storage

- Access token: **memory only**. Refresh token: **iOS Keychain / Android Keystore** via `expo-secure-store`
  (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`: not backed up, not migrated, unreadable while locked). Never AsyncStorage/localStorage (test-enforced).
- No secure store (Expo web) → memory-only fallback: the user signs in again next launch; nothing readable at rest.
- Refresh is single-flight (tokens are single-use). Only a definitive server rejection (4xx) ends the session; being offline or a 5xx keeps the
  stored token. Sign-out revokes the session server-side first, then wipes the device.
- Splash stays up until the saved session has been checked (no signed-out flash).

## Loading / offline / error

`useAsync` aborts stale requests and refetches on reconnect; `StateView` (loading · empty · error + retry); `OfflineBanner` appears app-wide
via NetInfo; `toViewError` maps "no response" → "Can't connect", 401 → session expired, 5xx → server trouble, otherwise a safe generic message.

## Deep links

Scheme `farmplus://`. Routes: `farm/:id animal/:id videos/:id live/:id marketplace/:id product/:id chat[/:id] wallet notifications` + tabs.
Every incoming URL passes `+native-intent.tsx` → `toRoute()` allow-list (ids `[A-Za-z0-9_-]{1,64}`); anything else (other paths, traversal,
other schemes, `http://`) opens Home. Expo Go form `exp://host/--/path` is accepted for development. Post-login return targets go through
`safeRedirect()` (internal paths only — open-redirect safe). Screens needing an account use `RequireAuth` (sign-in prompt that returns the user).
HTTPS universal/app links: set `FARMPLUS_LINK_HOST` at build time (adds `associatedDomains` / Android `intentFilters`) and host
`/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` on that domain (not done here).

## Permissions (prepared, not yet used by a feature)

`app.json` plugins declare Thai + English rationale strings for camera, microphone and photo-library access, `RECORD_AUDIO` on Android, and
block the legacy storage permissions. `src/lib/permissions.ts` requests them just-in-time and returns `granted | denied | blocked`
(blocked → `openAppSettings()`). Media selection should use the system picker (no broad media permission needed on Android 13+/iOS limited access).

## Verified / not verified

Verified: unit tests (117), typecheck, lint, Metro bundles for iOS + Android + web; **run on an iPhone 17 Pro simulator** (Expo Go) — Home, API
connection via LAN auto-detection, deep links (`videos/9` opens the video route, `farm/42` asks to sign in, `admin/users` falls back to Home);
interactive Expo-web run through tabs, register/sign-in/out, redirect safety, offline banner, API-down error + retry.
**Not verified:** any Android device/emulator (none available), physical devices, camera/mic/photo prompts, Keychain/Keystore behaviour
on a device (only the storage logic is unit-tested), HTTPS universal links, release (EAS) builds, screen readers.

## Known limitations

- iOS Keychain items survive app uninstall; a stale refresh token may remain until it expires/rotates (a first-run cleanup is a follow-up).
- Icon/splash images are Expo placeholders; no push notifications, no EAS config.
- No component-level (React Native renderer) tests; UI behaviour was verified on the simulator/web runs above.
