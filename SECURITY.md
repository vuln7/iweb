# Security

iweb stores sign-in tokens for people's accounts, so security reports are taken seriously.

**Please don't open a public issue for a vulnerability.** Report it privately through GitHub instead: open the repository's **Security** tab and choose **Report a vulnerability**. Include what you found, how to reproduce it, and what an attacker could do with it. You'll get a reply as soon as possible, and credit in the fix if you want it.

## What iweb already does

- Sign-in tokens stay on the server, in the data folder, and are never sent to the browser.
- Sign-in uses the OAuth authorization-code flow with a CSRF `state` check, and asks only for read access.
- `IWEB_PASSWORD` locks an internet-facing install. The session cookie is HttpOnly and SameSite=Lax, and it is Secure when `BASE_URL` uses https. Wrong passwords are rate-limited.
- Feed URLs typed in by users can't reach private, loopback or link-local addresses, including through redirects or DNS tricks (`lib/guard.js`).
- Post text from platforms is always rendered as text, never as HTML.
- Demo mode accepts no writes.

If you run iweb on the internet, set `IWEB_PASSWORD` and serve it over HTTPS.
