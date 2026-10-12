# Safety plan

Protection the app needs before and while the web app is built. Sign-up is
closed for now: only users created by the owner can log in.

## Before the web app

1. **Login attempt limits.** A few tries per IP and per email, then "too many
   attempts, wait". Stops password guessing, and stops a login flood from
   overloading the server, since every password check is slow and
   memory-heavy on purpose. Tool: `@fastify/rate-limit`, plus a general limit
   on every route.
2. **Secure sessions.** The cookie holds a long random token; the database
   stores only its hash, so a database leak logs no one in. Cookie flags:
   `HttpOnly` (page scripts can't read it), `Secure` (HTTPS only),
   `SameSite=Lax`. Sessions expire, and logout deletes them.
3. **Same login answer for any failure.** A wrong email and a wrong password
   get the same message and take the same time (a dummy password check runs
   when the email doesn't exist), so no one can find out which emails have
   accounts.
4. **Every query scoped to the organization.** Each route checks that what it
   reads or changes belongs to the logged-in user's organization, so changing
   an id in the URL never shows another company's data.
5. **Input validation.** A schema for every request body and a maximum body
   size, so malformed or oversized requests stop before our code runs.
6. **Security headers.** `@fastify/helmet`: blocks other sites from framing
   our pages (clickjacking) and limits which scripts can run (XSS).
7. **Forged requests (CSRF).** `SameSite` cookies, plus a check that
   state-changing requests come from our own site (`Origin` header).
8. **No leaked details.** Generic error answers, details only in logs. The
   logger hides passwords, tokens and cookies (pino `redact`). Failed logins
   are logged, so attempts are visible.

## Login location

Each session records the login's IP and browser. A local lookup database
(MaxMind GeoLite2, no outside call) turns the IP into country and city. When a
LinkedIn account is connected through Unipile, a proxy in that same region is
used, so LinkedIn sees the account used from a consistent place.

- Can't be tested locally: `127.0.0.1` has no location.
- Online, the server sits behind a proxy, so it must read the real visitor IP
  (`trustProxy`); rate limits need it too.
- An IP is personal data under LGPD. Keep only what is used (IP, country,
  city, browser), for security and account consistency.

## When going online

- HTTPS everywhere, and `trustProxy` set for the hosting proxy.
- A protection layer in front (e.g. Cloudflare) to absorb bot floods.
- A CAPTCHA (e.g. Cloudflare Turnstile) only if public forms appear.
- `npm audit` for vulnerable packages, and database backups.

## Steps

1. Server safety net in `server.ts`: helmet, general rate limit, log redaction.
2. Sessions table (SQL): token hash, expiry, IP, browser, country, city.
3. Sessions in `schema.ts`.
4. Session functions: create (random token, store its hash), find, delete.
5. Login, logout and "who am I" routes: stricter login limit, same answer for
   any failure, cookie, IP and browser saved.
6. `user:create` script to create the first users.
7. Web app setup (Vite + React + Tailwind in `web/`), importing the design.
8. Login page from the design, then layout and the other pages one at a time.
9. IP → location lookup, used for the Unipile proxy when connecting an account.
