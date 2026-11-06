# ADR-0003: Email link sign-in, the iOS recorder and the access list

- **Status:** Accepted
- **Date:** 2026-11-06
- **Supersedes:** none
- **Author:** founding agent (claude)

## Context

The previous version used Google sign-in through Firebase and a list of allowed emails. Lzno's other products sign in with an email link through Resend (`mail.lzno.app`, an existing account). The PRD adds a native iOS recorder that uploads in the background and is protected with Face ID, and keeps an access list managed by the owner. Only people on the list can sign in; with hosted keys the list is also who may spend Lzno's transcription credit.

## Options

1. **Email link for the web and the app**, with the app finishing the sign-in itself. Same as the other products; no passwords; Resend free plan.
2. **Passkeys.** No email provider, but more code on both sides and harder recovery for family members.
3. **Sign in with Apple or Google.** New accounts and app reviews, and a third party in the middle.
4. **For the app, a one-time code typed from the web** (like harina's device link). Works, but two devices are needed to start.

## Decision

Option 1.

- **Web:** the person types an email; if it is on the list (or in `MINUTECA_ADMIN_EMAILS`), we email a link valid for 30 minutes and usable once. The answer is the same either way. `GET /acceso` only shows a button, because mail scanners open links; `POST /api/auth/session` starts a 30 day session in an `HttpOnly`, `SameSite=Lax` cookie (`__Host-` on HTTPS). Cookie-authenticated writes must come from our own `Origin`. Only hashes of links and sessions are stored.
- **iOS app:** the app creates a random verifier, keeps it in the Keychain and sends only `base64url(SHA-256(verifier))` with the request (as in OAuth PKCE). The emailed link opens the same web page, which for app links offers "Abrir en la grabadora" (`minuteca://acceso?t=…`). The app sends the token with its verifier to `POST /api/auth/app-token` and receives a 90 day bearer token, stored in the Keychain on this device only. Another app that registers the same URL scheme, or someone who sees the link, cannot use it without the verifier, and app links cannot open a browser session.
- **Face ID** (or the passcode) covers the app's screens when it comes back to the front; recording continues while locked. People can turn it off.
- **Access list:** admins add, remove and promote people in the app (or with `npm run access` when self-hosting). Removing someone ends their sessions and blocks sign-in; their meetings are not deleted by the removal and expire after 30 days (deleting a person's data is not an admin shortcut). Emails in `MINUTECA_ADMIN_EMAILS` are always admins and cannot be removed from the app.
- Rate limits per IP and per email on link requests (5 per minute) and on token exchanges.

## Consequences

- The hosted version needs the `RESEND_API_KEY` secret and the verified `mail.lzno.app` domain (both exist).
- Losing access to the email means losing access to the account; support can only help by email.
- The app depends on the web page for one tap during sign-in; universal links would remove it but need an associated domain and signing changes (revisit with a new ADR if it confuses people).
- Self-hosting: no email provider needed (`MAIL_PROVIDER=console` prints the links). The app can point to any server from its sign-in screen.
