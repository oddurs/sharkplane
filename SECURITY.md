# Security Policy

SHARKPLANE is a fully static, client-only game: no server, no accounts, no network requests after load.
The attack surface is the browser bundle and the values it reads back from `localStorage`.

## Reporting a vulnerability

Please **do not** open a public issue. Use GitHub's private reporting:
**Security → Report a vulnerability** on the repository. You'll get a response within 7 days.

## Scope

- Supply-chain issues in dependencies (`npm audit` runs in CI; Dependabot is enabled).
- Anything that lets a crafted URL or stored value execute code or break the page.
- CSP bypasses (the site ships a `<meta>` Content-Security-Policy).
