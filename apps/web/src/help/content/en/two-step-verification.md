---
slug: two-step-verification
title: Turn on two-step verification
summary: Protect your account by entering a code from an app on your phone every time you sign in
audience: member
category: account
relatedRoutes: [/admin/account/security, /farms/sign-in]
keywords: [two-step verification, two-factor, 2FA, MFA, TOTP, security, authenticator app, Google Authenticator, Authy, 1Password, scan QR, QR code, recovery code, lost phone, new phone, code is incorrect]
order: 6
updatedAt: 2026-11-24
goTo: /admin/account/security
---

Two-step verification (MFA) stops other people from getting into your account even if they know your password, because they also need the 6-digit code from the app on your phone.

## Steps

1. Install an authenticator app on your phone, such as Google Authenticator, Authy or 1Password
2. Sign in to FARM+ and open the [Account security](/admin/account/security) page
   ![The Account security page](img:2)
3. Under "Two-factor authentication (TOTP)", press "Start setup"
   ![The Start setup button under two-factor authentication](img:3)
4. Open the app on your phone, add an account, and scan the QR code on the screen
   ![The QR code to scan with the authenticator app](img:4)
5. If you cannot scan it, type the letters after "Secret:" into the app instead
   ![The secret key shown below the QR code](img:5)
6. The app shows a 6-digit number. Type it in "6-digit code"
   ![The 6-digit code field filled in](img:6)
7. Press "Enable MFA"
   ![The Enable MFA button](img:7)
8. When you see "MFA is enabled.", write down or save all the "Recovery codes" right away
   ![The list of recovery codes shown after turning it on](img:8)

:::warning Keep your recovery codes safe
Recovery codes are shown **only once** and each works one time. Write them on paper or keep them somewhere safe. Never send them to anyone
:::

:::note The message about administrators
The page may say that administrators must use MFA. That message is for administrators. Ordinary members can turn it on too
:::

The next time you [sign in](help:sign-in), after your password, open the app and type the 6-digit code in "Authenticator or recovery code".

:::trouble You lost your phone or got a new one
When signing in, type one of the **recovery codes** you saved in "Authenticator or recovery code" and press "Verify". Cross out the code you used, because it cannot be used again
:::

:::trouble It says "The verification code is incorrect."

- The code in the app changes every 30 seconds. Type the code that is showing now
- Set your phone's clock to automatic. If the time is off, the codes will not match
  :::

:::trouble The QR code does not appear
If you see "Could not create the QR code. Use the setup key below instead.", follow step 5 and type the secret key into the app
:::
