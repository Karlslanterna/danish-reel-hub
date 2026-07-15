# Security & Operational Robustness Audit — Lanterna

Scope: Supabase security, RLS, secrets, service role usage, auth/authorization, security headers, CSP, CORS, rate limiting, error handling, sensitive data exposure. MVP-relevant only. No changes were made.

Legend: **Critical** = exploitable now / data loss risk · **High** = likely exploitable or serious hardening gap · **Medium** = defense-in-depth · **Low** = polish.

---

## Critical

### C1. `/admin/import` has no authorization gate
- **Where:** `src/routes/admin.import.tsx`, `src/routes/admin.import_.$jobId.tsx`.
- **Issue:** The admin import UI is a public route. Access is "gated" only by asking the user to paste `KULTUNAUT_IMPORT_SECRET` into a text field, which the backend routes (`/api/public/kultunaut-import*`) then compare. There is no user-role check, no `_authenticated` layout, and the page is directly reachable at `/admin/import`. The secret is also cached in `sessionStorage` (`SECRET_STORAGE_KEY`), so anyone who ever borrows the browser inherits import capability.
- **Impact:** Anyone with the shared secret can create, mutate, or replace the entire catalog (movies, cinemas, showtimes). One secret leak = full data-integrity compromise. There is no per-user audit trail.
- **Recommended fix:** Move admin routes under `src/routes/_authenticated/admin/…`, add a `user_roles` table with an `admin` role and a `has_role()` SECURITY DEFINER function, gate the server routes on that role via `requireSupabaseAuth`, and stop storing the shared secret in `sessionStorage`. Keep the header secret only as a secondary machine-to-machine credential for cron / CI callers.

### C2. Import HTTP endpoints authenticate with a single static shared secret and no rate limiting
- **Where:** `src/routes/api/public/kultunaut-import.ts`, `kultunaut-import.process.ts`, `kultunaut-import.status.ts`.
- **Issue:** All three routes accept any caller presenting `x-kultunaut-secret: $KULTUNAUT_IMPORT_SECRET`. There is no signature, nonce, timestamp, IP allowlist, or rate limit. The upload endpoint accepts XML bodies up to 20 MB and immediately queues a service-role-driven write job. The comparison uses `===`, which is not constant-time (marginal, but not best practice for token compare).
- **Impact:** A leaked secret allows unlimited catalog rewrites and job spam (each job persists the full XML into `import_jobs`, unbounded — see M2). No throttle exists to slow a brute-force or replay.
- **Recommended fix:** Use `crypto.timingSafeEqual`; add a simple per-IP token-bucket in front of the three endpoints (e.g. Cloudflare KV or an in-DB counter); rotate the secret; and prefer signed requests (HMAC over body + timestamp) rather than a bearer-style shared token.

---

## High

### H1. `KULTUNAUT_IMPORT_SECRET` is entered client-side and persisted in `sessionStorage`
- **Where:** `src/routes/admin.import.tsx` (`SECRET_STORAGE_KEY`).
- **Issue:** The shared import secret is typed into a plain `<Input>` on a public route and cached in `sessionStorage`. Any XSS in any route running on the same origin (React libs, third-party fonts stylesheet, future integrations) can exfiltrate it. It is also visible in DevTools screenshots and browser sync in some setups.
- **Impact:** Elevates any minor XSS to full catalog write access.
- **Recommended fix:** After C1 is in place, delete the client-side secret field entirely — call the server routes from an authenticated admin server function that reads the secret from `process.env` server-side.

### H2. No security headers / Content Security Policy
- **Where:** `src/server.ts`, `src/start.ts`, `src/routes/__root.tsx`.
- **Issue:** Responses do not set `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, or `X-Frame-Options`/`frame-ancestors`. The app loads a Google Fonts stylesheet from a third origin, so a permissive CSP is needed, but the current absence means any injected script executes freely and the app can be framed by arbitrary origins (clickjacking risk on the OAuth consent screen at `/.lovable/oauth/consent`).
- **Impact:** Clickjacking of the OAuth consent flow (attacker frames it to trick a signed-in user into approving an MCP client); no defense-in-depth against reflected/stored XSS; MITM downgrade risk without HSTS on the custom domain.
- **Recommended fix:** Add a small response-middleware in `src/server.ts` that sets, at minimum: `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: geolocation=(self), camera=(), microphone=()`, `Content-Security-Policy: default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self' https://*.supabase.co https://*.lovable.cloud; frame-ancestors 'none'` (relax `frame-ancestors` only if editor preview embedding is required, and then to the Lovable preview origin only).

### H3. Google Fonts loaded from third-party origin without SRI or self-hosting
- **Where:** `src/routes/__root.tsx` (`fonts.googleapis.com`, `fonts.gstatic.com`).
- **Issue:** Cross-origin stylesheet loaded on every page. Not attackable today, but relies on Google's origin and expands the CSP surface (see H2).
- **Recommended fix:** Either self-host the Google Sans woff2 files, or accept the risk and constrain it in the CSP above.

### H4. Public MCP data endpoints run under service-key connection with no rate limit
- **Where:** `src/lib/mcp/supabase.ts`, `src/lib/mcp/tools/*`, `src/routes/mcp.ts`, `src/routes/[.mcp]/*`.
- **Issue:** The MCP server now requires OAuth (good), but once authorized, tool calls hit Supabase with the publishable key at unbounded QPS. `search_movies` and `search_cinemas` accept arbitrary substrings, and `get_showtimes` accepts a `limit` up to 200. A single authorized token can trivially exhaust Supabase quotas.
- **Recommended fix:** Add a per-authenticated-user rate limit at the `/mcp` entry point (e.g. 60 req/min per `sub` claim, tracked in Supabase or KV) and cap `search_movies` limit at ~50 (already done) and `search_cinemas` at ~50.

---

## Medium

### M1. Signup is enabled with no email allowlist; anonymous accounts can reach OAuth consent
- **Where:** `src/routes/auth.tsx`, Supabase auth config.
- **Issue:** The auth page offers open email/password signup and Google. For an MVP whose only authenticated surface is the OAuth consent page for MCP clients, this means anyone in the world can create an account and authorize an MCP client against Lanterna's data. Not a data leak (the data is public), but it inflates the auth user table and can be abused for token minting.
- **Recommended fix:** Either restrict signups (email domain allowlist, invitation flow, or `disable_signup: true` with admin-provisioned users) or accept the risk explicitly in security memory now that MCP data is public.

### M2. `import_jobs` retains full XML payloads indefinitely
- **Where:** `import_jobs.xml` (up to 20 MB per row), `src/lib/kultunaut/import.server.ts`.
- **Issue:** Every import stores the raw XML plus a `payload jsonb` snapshot forever. No TTL, no cleanup job. Grows unboundedly and increases blast radius if the table is ever exposed.
- **Recommended fix:** Add a scheduled cleanup (delete jobs older than 30 days, or null out `xml`/`payload` once `status = 'completed'`).

### M3. Service role client is used for reads that could use publishable key
- **Where:** `src/lib/kultunaut/import.server.ts` uses `supabaseAdmin` (RLS-bypassing) throughout. This is correct for writes but the same client is used for read-back queries during the merge phase.
- **Impact:** Small — the module runs only from the admin routes — but violates least privilege and makes future refactors risky.
- **Recommended fix:** Split reads onto the publishable-key server client where they don't need to see RLS-hidden rows; keep `supabaseAdmin` for the actual `upsert` calls.

### M4. CORS: MCP + import endpoints do not set explicit CORS headers
- **Where:** `src/routes/api/public/kultunaut-import*.ts`, `src/routes/mcp.ts`, `src/routes/[.mcp]/*`.
- **Issue:** Endpoints rely on default same-origin behavior. Browsers won't attach the `x-kultunaut-secret` header cross-origin without a preflight the server never answers, so the current state is *closed by default* (good), but there is no explicit `Access-Control-Allow-Origin: <none>` / `Vary: Origin` policy declared, and no `OPTIONS` 405 handling. If a future edit adds any CORS to one route the others become ambiguous.
- **Recommended fix:** Add explicit `Access-Control-Allow-Origin` handling only where cross-origin is intentional (MCP tool endpoints for external agents), and reject `OPTIONS` on the import endpoints.

### M5. Error responses can leak internal messages
- **Where:** `src/routes/api/public/kultunaut-import*.ts` returns `Process failed: ${err.message}` and `Status failed: ${err.message}` verbatim to the client. MCP tools return raw `error.message` from PostgREST.
- **Impact:** Leaks Postgres error strings, column names, and stack hints to unauthenticated (import routes gated only by the shared secret — see C2) or authenticated MCP callers.
- **Recommended fix:** Log the full error server-side and return a generic message + a short opaque error id to the caller.

### M6. `SUPABASE_DB_URL` is listed as a secret in the project
- **Where:** secrets list (see project context).
- **Issue:** A direct-connect Postgres URL should not be needed at runtime for a TanStack Start app that uses the Supabase JS client. If nothing reads it, it's dead weight; if something does, it bypasses PostgREST and RLS.
- **Recommended fix:** Confirm nothing in the codebase reads `SUPABASE_DB_URL` (`rg SUPABASE_DB_URL src`), and if not, delete the secret.

---

## Low

### L1. `og:image` on the root route points to a preview-project R2 URL
- **Where:** `src/routes/__root.tsx`.
- **Issue:** Uses an `id-preview-…lovable.app` screenshot URL as production Open Graph image. Not a security issue directly, but the URL is workspace-scoped and can rot; it also embeds preview metadata on the published domain.
- **Recommended fix:** Host the OG image on the production domain (`/og-image.png` already exists in `public/`) and reference it absolutely.

### L2. `Poster.tsx` / third-party image domains have no CSP allowlist
- Same root cause as H2; once CSP lands, ensure `img-src` covers the poster CDN(s) actually in use.

### L3. `robots` meta on admin routes only
- Admin routes correctly set `noindex, nofollow`. Consider adding a top-level `/robots.txt` disallowing `/admin/`, `/auth`, `/.lovable/oauth/consent`, `/mcp`, and `/api/` for belt-and-braces.

### L4. `attachSupabaseAuth` calls `supabase.auth.getSession()` on every server-fn call
- Minor latency/robustness cost — noted for future replacement with a cached bearer attacher, not a security issue.

### L5. Password policy
- Auth uses default Supabase password rules. Consider enabling HIBP leaked-password protection via `supabase--configure_auth` (`password_hibp_enabled: true`) once any real user accounts exist.

---

## Notes on things that are *fine* for the MVP

- RLS is enabled on all three public catalog tables (`movies`, `cinemas`, `showtimes`) with SELECT-only policies for `public`. `INSERT/UPDATE/DELETE` are correctly denied to the API roles; writes only happen through the service-role admin client server-side.
- `import_jobs` has no policies and is not exposed to the Data API for `anon`/`authenticated`; only the service role touches it. This has already been reviewed and marked accepted in security memory.
- Publishable Supabase URL and anon key in `.env` and `client.ts` are safe to be public.
- Service role key is only imported inside `src/integrations/supabase/client.server.ts` and loaded lazily inside handlers via `await import(...)` — no client-bundle leak.
- OAuth consent screen validates `authorization_id`, preserves `next` through sign-in, only follows same-origin `next` values (`isSafeNext`), and uses `errorComponent` for readable failure. Good.
- Geolocation is requested only on user click of "Afstand fra mig" — no silent prompt on load.
