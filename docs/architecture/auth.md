# Authentication, roles & permissions (Part 03)

## Tokens and sessions

- **Access token**: JWT (HS256, 15 min default) with only `sub` and `sid`. On **every** request the API also
  checks the session row (not revoked/expired) and that the user is `active`, then resolves roles →
  permissions from the database. Nothing is cached, so logout, suspension and role changes apply immediately.
- **Refresh token**: 48 random bytes, stored only as SHA-256. Single-use rotation; presenting a used token
  revokes the whole session (theft detection). Sliding expiry (30 days default).
- Passwords: scrypt (N=2^15, r=8, p=1, per-user salt, parameters stored in the hash). Min 10 / max 128 chars.
- Responses go through `toPublicUser`; password hashes, token hashes and MFA secrets are never serialised.

## RBAC

Roles (`super_admin … buyer`) map to permissions in `role_permissions`. Defaults live in
`services/api/src/rbac/definitions.ts`. `farm_owner`, `seller`, `buyer` hold **no** global permissions:
their access is ownership-based (`requireOwnerOrPermission`, used now for `/users/:id`, reusable for
farms/animals/listings — the owner passes, anyone else needs the named bypass permission such as `farms.manage`).

### Privilege-escalation rules (role-service)

1. Self-registration yields only `buyer`; request bodies are `strict`, so extra fields (`roles`, `status`) are rejected.
2. Nobody can change their own roles.
3. Assigning/revoking needs `roles.manage` **and** the actor must hold every permission of the target role.
4. `super_admin` and `admin` can only be granted/revoked by a `super_admin`.
5. Changing a role's permissions needs `permissions.manage` and you may only add permissions you hold; `super_admin` is immutable.
6. Suspending/deactivating: not yourself, not someone with permissions you lack, not a protected-role holder unless you are `super_admin`.
7. The last `super_admin` cannot be removed.

### MFA for administrators

Admin roles (`super_admin, admin, registration_admin, finance_admin, moderator, support`) have `requiresMfa`.
Their permissions are **withheld** until the session is MFA-verified (TOTP, RFC 6238, replay-protected, plus
10 single-use recovery codes). Without MFA the API answers `403 MFA_REQUIRED` and `/auth/me` reports
`mfaRequired: true`. Holders of an admin role cannot disable MFA.

## Social sign-in (Google / Facebook)

Server-side OAuth 2.0 authorization-code flow with PKCE, under `/api/v1/auth/oauth`. Provider secrets stay on the API.

1. **Start** — `GET /:provider/start?returnTo=…&challenge=…`. The client first makes a random `verifier` and sends only
   `challenge = base64url(SHA-256(verifier))`. `returnTo` must equal one of `OAUTH_RETURN_URLS` exactly (no open
   redirect). The API stores a 10-minute flow (state hash, its own PKCE verifier, the client challenge) and redirects to
   the provider.
2. **Callback** — the provider returns to `<API_PUBLIC_URL>/api/v1/auth/oauth/:provider/callback`. The state is claimed
   atomically (single use, provider-bound), the code is exchanged server-to-server, and the browser is sent to
   `returnTo?ticket=…` or `returnTo?error=<code>` (`cancelled`, `provider_error`, `account_exists`,
   `account_suspended`, `account_deactivated`).
3. **Exchange** — `POST /exchange {ticket, verifier}` returns the same body as `POST /auth/login`. The ticket is
   single-use, lives 2 minutes and only works with the verifier behind the challenge from step 1, so a ticket seen in a
   URL, a browser history or another app's deep-link handler is useless elsewhere. Accounts with MFA still get
   `mfa_required`.

**Which account signs in**

| Situation                                                                                       | Result                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Provider account already linked                                                                 | that FARM+ account                                                                                                                                                                               |
| Google says the email is verified, and a FARM+ account with that email has **also** verified it | linked automatically (`auth.oauth_linked`)                                                                                                                                                       |
| Same email but the FARM+ account never verified it, or Facebook, or Google did not verify it    | refused: `account_exists` (sign in with the password) — prevents taking over, or handing over, a pre-registered address                                                                          |
| No matching account                                                                             | new active account with the buyer role (`auth.oauth_register`); a Google-verified email is bound and marked verified; a Facebook email is **not** bound (Facebook does not say it was confirmed) |

Social-only accounts have an unusable random password; with an email or phone they can set one through "forgot
password". Suspended/deactivated accounts are refused. Facebook Graph calls are signed with `appsecret_proof`.
`OAUTH_MOCK=true` (refused in production) replaces both providers with a stand-in for development and tests.

Setup: create a Google OAuth client ("Web application") and a Facebook Login app, register the two callback URLs, then
set the variables listed in `.env.example` / [environments](../ops/environments.md).

## Abuse protection

Rate limits: password sign-in 10 per 15 min **per client address + account** (so one person's mistakes on a shared
network do not lock others out) plus 100 per 15 min per address (one client cannot try account after account);
Google/Facebook sign-in has its own budget, 60 requests (20 sign-ins) per 15 min per address, never spent by password
attempts; MFA 10 per 15 min, register/reset/verify 10 per hour, refresh and tab hand-off 60 per 15 min per address;
account lock for 15 min after 10 failed attempts, constant-ish login timing for unknown accounts, generic
`INVALID_CREDENTIALS`, `forgot`/`resend` always 202, `Cache-Control: no-store` on auth routes.

## New tabs (tab hand-off)

The web keeps the refresh token in each tab's `sessionStorage`, so a link opened in a new tab used to land on the
sign-in page. A new tab without a session now asks the other FARM+ tabs of the same browser on a same-origin
`BroadcastChannel` (`apps/web/src/auth/tabHandoff.ts`): one signed-in tab offers, the new tab takes that offer, and
the signed-in tab calls `POST /auth/session/handoff`, which creates a **separate session** for the same person with the
same second-factor state (refresh tokens are single-use, so a tab never passes on its own). The new session is listed
and revocable under `/auth/sessions` and audited (`auth.session_handoff`). Signing out one tab ends only its session.
No token is written to `localStorage` or cookies; a `farmplus.signedInTab` hint (no secret) only lets a guest's first
page skip waiting (400 ms) for an answer that will not come. Anything that could read `sessionStorage` (same-origin
script) could already use the session, so the channel adds no new exposure.

## Audit

`audit_logs` records registration, login/failed login/lock, logout, password reset/change, MFA enable/disable,
refresh-token reuse, tab hand-off, role assign/revoke, role-permission changes (with diff), status changes (with reason),
admin profile edits and super-admin bootstrap.

## Bootstrapping the first super admin

There is deliberately no API for it. With the API env configured:
`BOOTSTRAP_ADMIN_PASSWORD='<12+ chars>' pnpm --filter @farmplus/api admin:create -- --email you@example.com --name "Your Name"`
Then sign in and enrol TOTP; admin permissions only become active after that.

## Known limitations / follow-ups

- Email/SMS delivery is an interface (`Notifier`); dev logs to console, production default drops messages
  until a provider is wired. Verification-required mode (`AUTH_REQUIRE_VERIFICATION`) is only usable once delivery exists.
  **As of 24 Nov 2026 staging runs with it on and no provider**: e-mail/phone sign-ups cannot complete there (Google works).
- Rate-limit counters are in-memory per API instance; use a shared store (Redis) when scaling out.
- Refresh tokens are returned in the JSON body for both clients. For Web, an `httpOnly` cookie is stronger — revisit with the Web auth UI.
- Audit writes are not transactional with the change they describe (standalone MongoDB in tests; use a replica set + transactions for strict atomicity).
- `register` returns 409 for an existing email/phone (account enumeration is mitigated only by rate limiting).
- No concurrent-refresh grace window: two simultaneous refreshes with the same token log the user out.
- Web UI: sign-in (with "send the link again" when the API answers `ACCOUNT_NOT_VERIFIED`), register, check-email,
  verify-phone, `/farms/verify-email?token=`, `/farms/forgot-password` and `/farms/reset-password?token=` (the token is
  removed from the address bar on arrival). A real e-mail provider must build its links to exactly these two paths.
  Mobile has no forgot/reset screens yet.
