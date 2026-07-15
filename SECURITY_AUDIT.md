# Security & Operational Robustness Audit — Lanterna

Scope: Supabase security, RLS, secrets, service role usage, auth/authorization, security headers, CSP, CORS, rate limiting, error handling, sensitive data exposure. MVP-relevant only. No changes were made.

Legend: **Critical** = exploitable now / data loss risk · **High** = likely exploitable or serious hardening gap · **Medium** = defense-in-depth · **Low** = polish.

---

## Critical

### C1. ✅ RESOLVED — `/admin/import` now requires an authenticated admin user
- **Where:** `src/routes/_authenticated/admin.import.tsx`, `src/routes/_authenticated/admin.import_.$jobId.tsx`, `src/routes/_authenticated/route.tsx`, `src/lib/admin.functions.ts`.
- **Original issue:** The admin import UI was a public route gated only by a `KULTUNAUT_IMPORT_SECRET` typed into a text field and cached in `sessionStorage`.
- **Implementation (this change):**
  - **Database.** New migration adds `app_role` enum (`admin`, `moderator`, `user`), `public.user_roles(user_id, role)` table (unique per pair, FK to `auth.users` with cascade delete), and a `public.has_role(_user_id, _role) SECURITY DEFINER STABLE` function on `search_path = public`. Grants: `SELECT` on `user_roles` to `authenticated`, `ALL` to `service_role`; `EXECUTE` on `has_role` revoked from `PUBLIC`/`anon` and granted to `authenticated`/`service_role`. RLS enabled on `user_roles`; single policy lets a signed-in user read only their own rows. Role assignments happen exclusively server-side (no INSERT/UPDATE/DELETE policies), so escalation from the client is impossible.
  - **Route layer.** New pathless `_authenticated` layout (`src/routes/_authenticated/route.tsx`, `ssr: false`) calls `supabase.auth.getUser()` in `beforeLoad` and redirects unauthenticated visitors to `/auth` preserving `next`. The admin routes moved under it (`/_authenticated/admin.import.tsx` and `/_authenticated/admin.import_.$jobId.tsx`) — URLs stay `/admin/import` and `/admin/import/$jobId`. Each admin route's `beforeLoad` additionally calls the `checkIsAdmin` server function and redirects to `/auth` if the caller lacks the `admin` role, so non-admin authenticated users can't see the page either.
  - **Server functions.** New `src/lib/admin.functions.ts` exposes `checkIsAdmin`, `adminCreateImportJob`, `adminProcessImportJob`, and `adminGetImportJobStatus`. All four use `.middleware([requireSupabaseAuth])` and, except for `checkIsAdmin`, call an internal `assertAdmin(context)` that invokes `has_role(userId, 'admin')` via RPC and throws Forbidden if the caller is not an admin. The server functions wrap the existing `createImportJob` / `processJobBatch` / `getJobStatus` helpers in `src/lib/kultunaut/import.server.ts`, so import behavior is unchanged. Zod validators enforce that the XML payload is 1..20 MB and `jobId` is a UUID.
  - **UI.** All shared-secret prompts and the `SECRET_STORAGE_KEY` `sessionStorage` cache are removed from both admin pages. The UI now calls the new server functions via `useServerFn`; the bearer token is attached automatically by the `attachSupabaseAuth` `functionMiddleware` already registered in `src/start.ts`.
- **Bootstrapping the first admin (one-time manual step):** sign in once at `/auth` to create your `auth.users` row, then run this SQL through the Cloud backend SQL editor (Cloud → SQL):
  ```sql
  INSERT INTO public.user_roles (user_id, role)
  SELECT id, 'admin' FROM auth.users WHERE email = 'you@example.com';
  ```
  Consider disabling open signups after that (`supabase--configure_auth` with `disable_signup: true`) to prevent random accounts from being created just to attempt privilege escalation.
- **What did NOT change:** the `/api/public/kultunaut-import*` HTTP endpoints and their shared-secret header still exist, unchanged, so cron / external callers keep working. They are no longer used by the admin UI. See C2 for their remaining hardening work.

### C2. Import HTTP endpoints authenticate with a single static shared secret and no rate limiting
- **Where:** `src/routes/api/public/kultunaut-import.ts`, `kultunaut-import.process.ts`, `kultunaut-import.status.ts`.
- **Issue:** All three routes accept any caller presenting `x-kultunaut-secret: $KULTUNAUT_IMPORT_SECRET`. There is no signature, nonce, timestamp, IP allowlist, or rate limit. The upload endpoint accepts XML bodies up to 20 MB and immediately queues a service-role-driven write job. The comparison uses `===`, which is not constant-time (marginal, but not best practice for token compare).
- **Impact:** A leaked secret allows unlimited catalog rewrites and job spam (each job persists the full XML into `import_jobs`, unbounded — see M2). No throttle exists to slow a brute-force or replay.
- **Status update:** the admin UI no longer depends on these endpoints (C1 replaces them with authenticated server functions). If you have no external / cron caller, delete these three files and drop `KULTUNAUT_IMPORT_SECRET` from secrets. If you keep them, add per-IP rate limiting and switch to `crypto.timingSafeEqual`.
- **Recommended fix:** Use `crypto.timingSafeEqual`; add a simple per-IP token-bucket in front of the three endpoints (e.g. Cloudflare KV or an in-DB counter); rotate the secret; and prefer signed requests (HMAC over body + timestamp) rather than a bearer-style shared token.

---

## High

### H1. ✅ RESOLVED — `KULTUNAUT_IMPORT_SECRET` is no longer entered client-side
- **Where:** was `src/routes/admin.import.tsx` (`SECRET_STORAGE_KEY`).
- **Fix (this change):** The password `<Input>` and the `SECRET_STORAGE_KEY` `sessionStorage` cache are gone from both admin routes. The import server functions run under `requireSupabaseAuth` + `has_role('admin')` and never expose the shared secret to the browser. If the `/api/public/kultunaut-import*` endpoints are retained for cron, the secret lives only in server-side env (see C2).

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
