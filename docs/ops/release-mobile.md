# Mobile release (Expo EAS, Android, iOS)

Store policies change; **verify every requirement below against the current Google Play and Apple documentation when you submit.** This
document records what the project needs and what the repository already does.

## Build pipeline (EAS)

`apps/mobile/eas.json` defines three profiles, `.github/workflows/mobile-eas.yml` triggers them, `apps/mobile/app.config.ts` guards release builds.

| Profile       | Distribution         | Android | iOS                                   | EAS environment | Channel       |
| ------------- | -------------------- | ------- | ------------------------------------- | --------------- | ------------- |
| `development` | internal, dev client | APK     | simulator build                       | `development`   | `development` |
| `preview`     | internal (testers)   | APK     | internal (ad hoc/TestFlight internal) | `preview`       | `preview`     |
| `production`  | store                | **AAB** | App Store build                       | `production`    | `production`  |

- **Versioning** is remote (`appVersionSource: remote`) with `autoIncrement` for production: EAS increments `versionCode`/`buildNumber`; `expo.version` in `app.json` is the human version (bump it per release).
- **Release guard**: a `production` build (or `FARMPLUS_RELEASE=true`) **fails** unless `EXPO_PUBLIC_API_BASE_URL` is an `https://` URL that is not local, and `EAS_PROJECT_ID` is set. The runtime also refuses non-https API URLs in production builds.
- **Runtime version policy** `appVersion`: a binary only talks to the JS it was built with. **No over-the-air updates** are configured (no `expo-updates`); every change ships through the stores. Adding OTA later is a deliberate decision (it changes the review/rollback story).
- **Credentials** (Apple certificates/profiles, Android upload key) are created and stored by EAS (`eas credentials`) — never in the repository or CI. The CI secret is one scoped, revocable `EXPO_TOKEN` available only to the `mobile-*` GitHub environments (production requires approval).
- **One-time setup**: `eas login` → `eas init` (writes the project id; put it in `EAS_PROJECT_ID`) → `eas credentials` → set `EXPO_PUBLIC_API_BASE_URL`, `FARMPLUS_LINK_HOST` per EAS environment (`eas env:create …`).
- **Build**: `eas build --profile production --platform all` (or run the workflow). **Submit**: `eas submit --profile production` (store credentials/App Store Connect API key are configured in EAS, not here).

## Android (Google Play)

Identity: package `com.farmplus.app`. Needed before the first release:

- Google Play Console developer account (identity verification; organisation accounts need a D-U-N-S number), app created with the same package name.
- **Play App Signing** (use it; EAS uploads with the upload key). Upload the **AAB**, not an APK.
- **Target API level** must meet Google's current requirement (updated yearly; Expo SDK builds target it — check at each submission).
- **Data safety form**: declare what is collected (account info, email/phone, farm/animal records, photos/videos, financial info for orders, user-generated content, messages, approximate/precise location only if used) and that data is encrypted in transit; describe deletion.
- **Privacy policy URL** (public page) and, if the app has accounts, a way to **request account and data deletion** (in-app and a web URL).
- **Permissions**: the app declares camera, microphone and photo access with Thai/English purpose strings (`app.json`); storage permissions are explicitly blocked. Review the merged manifest in the bundle (`bundletool` or the Play pre-launch report) for unexpected permissions.
- Content rating questionnaire; target audience (not for children); ads declaration (none); app category.
- **Testing tracks**: internal → closed → production staged rollout (start at 5–20 %). New personal developer accounts may have to run a closed test with a minimum number of testers for a minimum period before production — check the current rule.
- Deep links: host `/.well-known/assetlinks.json` on `FARMPLUS_LINK_HOST` (fingerprint of the Play signing key) so `autoVerify` works.
- Firebase/Google services are not used; no `google-services.json` is needed today.

## iOS (App Store)

Identity: bundle id `com.farmplus.app`. Needed:

- Apple Developer Program membership (organisation enrolment needs a D-U-N-S number), App Store Connect app record.
- **Privacy**: App Privacy ("nutrition label") answers, privacy policy URL, and **in-app account deletion** (Apple requires apps that let people create an account to let them delete it in the app).
- Permission usage strings are present (camera, microphone, photo library); `ITSAppUsesNonExemptEncryption: false` is declared because the app only uses standard HTTPS/OS encryption — confirm this stays true.
- **App Review**: provide a working demo account (no MFA prompt blocking reviewers, or a reviewer-specific path) and notes explaining roles, live streaming and marketplace moderation. Apps with user-generated content need **reporting, blocking and moderation** (present: community reports, chat reports/blocks, moderator queue) and a way to contact support.
- Physical goods and livestock sold through the app are outside In-App Purchase rules; payments for digital content would not be. Re-check the guidelines when payments launch, and Apple's/Google's rules on regulated goods (live animals, medicines, feed additives are policy-sensitive: keep the prohibited-product controls, Part 14).
- **TestFlight**: internal testers immediately, external testers after beta review. Release with phased release enabled.
- Universal links: host `/.well-known/apple-app-site-association` on `FARMPLUS_LINK_HOST` (no redirect, `application/json`).

## Known blockers to resolve before the first store submission

1. **Account and data deletion**: the API has no self-service account-deletion/erasure endpoint or flow yet. Both stores (and PDPA data-subject rights) require one; design it with legal (retention of financial/audit records vs erasure) and build it before submitting.
2. **Privacy policy and terms pages** (public URLs) and the store listing assets/screenshots/support contact.
3. **A real payment provider** is not implemented (`PAYMENT_PROVIDER=none`): decide whether the first release ships with payments disabled (acceptable; say so in the listing) or wait.
4. **Client-side error reporting** is not installed (monitoring.md).
5. Store accounts, Apple/Google credentials, `EAS_PROJECT_ID`, domain for universal links — none exist in this repository's environment.

## Release checklist

- [ ] Staging API verified (`verify-deployment.mjs`) and the production API deployed first (mobile builds depend on API compatibility; the API must keep supporting the previous app version for at least the staged-rollout window).
- [ ] `expo.version` bumped; changelog written; `pnpm --filter @farmplus/mobile typecheck` and `test` green.
- [ ] `production` EAS build succeeds (release guard passes); install the produced build on a real Android and iOS device and exercise: sign-in/MFA, animal photo upload, video, live viewer, marketplace offer, chat, notifications, deep links.
- [ ] Store listing, privacy forms and screenshots complete; account deletion available (blocker 1).
- [ ] Staged rollout started at a small percentage; crash/ANR and API error dashboards watched for 24 h before widening.
- [ ] Rollback plan understood: **binaries cannot be recalled** — halt the rollout / remove from sale, ship a fixed build (expedited review), and keep the server backward compatible ([rollback-incident.md](rollback-incident.md)).
