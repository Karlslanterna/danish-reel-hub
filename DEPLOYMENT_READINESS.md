# Production Deployment Readiness Audit — Lanterna

Scope: environment / secrets / build / deploy / rollback / migrations / Supabase
config / scheduled jobs / import pipeline / cache / CDN / security headers /
HTTPS / custom domain (lanterna.dk) / logging / monitoring / backup /
recovery. UI, SEO and application features are out of scope.

Legend: **Critical** = blocks safe launch · **High** = must fix before beta ·
**Medium** = defense-in-depth · **Low** = polish. Effort: XS <1h · S <½d ·
M <2d · L >2d.

---

## Critical

### C1. No scheduled import job — catalog goes stale silently
- **Area:** Scheduled jobs, import pipeline deployment.
- **Why it matters:** `import-health` already flags "critical" because the
  last successful import in this environment is >40 days old. There is no
  cron, no pg_cron entry, and no external scheduler calling
  `/api/public/kultunaut-import`. Without an automatic trigger the entire
  product data set decays; health monitoring detects it but nothing acts.
- **Recommended fix:** Add a pg_cron job (or external scheduler) that POSTs
  to the stable `project--<id>.lovable.app/api/public/kultunaut-import`
  endpoint on a daily cadence, followed by `.process` until `status=completed`.
  Alert on `import-health` returning 503.
- **Effort:** S.

### C2. Import endpoints still gated only by a static shared secret with no rate limit
- **Area:** Import pipeline deployment, secrets management.
- **Why it matters:** `KULTUNAUT_IMPORT_SECRET` is a single long-lived token
  compared with `===` (not constant-time), 20 MB body accepted, no per-IP
  throttle. Leaking it lets anyone rewrite the catalog and fill
  `import_jobs` with 20 MB rows. Already tracked as C2 in
  `SECURITY_AUDIT.md`; deployment-blocking because these are the routes the
  scheduler in C1 will hit.
- **Recommended fix:** `crypto.timingSafeEqual`, per-IP token bucket,
  rotate secret at cutover, and either delete or lock these routes down
  once cron is in place. Confirm secret is present in the production
  environment (not just preview).
- **Effort:** S.

### C3. No security headers / HSTS / CSP on production responses
- **Area:** Security headers, HTTPS, custom-domain readiness.
- **Why it matters:** `src/server.ts` sets only `x-robots-tag`. Without
  `Strict-Transport-Security`, browsers will not pin lanterna.dk to HTTPS
  after the first visit; without CSP + `frame-ancestors`, the OAuth consent
  screen can be clickjacked. Tracked as H2 in `SECURITY_AUDIT.md` but must
  land before the custom domain is announced — HSTS preload is one-way.
- **Recommended fix:** In `src/server.ts` add a header layer applied to
  every HTML response: HSTS (2y, includeSubDomains, preload), CSP with the
  allowlist from `SECURITY_AUDIT.md#H2`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`,
  `frame-ancestors 'none'` (or the Lovable preview origin only).
- **Effort:** S.

### C4. No backup or point-in-time recovery strategy documented
- **Area:** Backup strategy, recovery procedure.
- **Why it matters:** Supabase's default managed backups on the free tier
  are daily snapshots with no PITR. `movies`/`cinemas`/`showtimes` are
  fully rederivable from Kultunaut, but `auth.users`, `user_roles`, and
  `import_jobs` history are NOT. No documented restore drill exists.
- **Recommended fix:** (a) Confirm plan tier and whether PITR is enabled;
  (b) enable daily logical export of `auth.users` + `user_roles` to R2 via
  a cron server route; (c) write a one-page runbook covering "restore
  auth", "rebuild catalog from Kultunaut", and "roll back last import job".
- **Effort:** M.

---

## High

### H1. Rollback path is undocumented and coupled to the frontend publish flow
- **Area:** Deployment process, rollback capability.
- **Why it matters:** Lovable frontend deploys via "Update" in the publish
  dialog; there is no explicit "previous release" affordance documented in
  this repo. Server functions and migrations deploy immediately and
  independently. A bad migration or server-fn change cannot be rolled back
  by reverting the frontend alone.
- **Recommended fix:** Document in `DEPLOYMENT_READINESS.md` (this file)
  the exact rollback steps: (a) revert the offending commit in Lovable
  chat, (b) for schema, ship a forward-only revert migration, (c) for the
  import pipeline, use the admin UI to mark the last job failed and re-run
  the previous good XML. Add a `.lovable/RELEASE_NOTES.md` per release.
- **Effort:** S.

### H2. No release/version identifier baked into the build
- **Area:** Build configuration, monitoring, logging.
- **Why it matters:** `ERROR_MONITORING.md` reports `release` from
  `VITE_APP_RELEASE`, but that env is never set — every event will be
  tagged `"dev"` in production. Without release IDs, error monitoring
  cannot distinguish regressions per deploy.
- **Recommended fix:** Inject `VITE_APP_RELEASE` at build time from the
  git SHA (or the Lovable deployment ID if exposed). Fall back to
  `import.meta.env.MODE` only for local dev.
- **Effort:** XS.

### H3. No structured server logging or log aggregation beyond raw `console.error`
- **Area:** Logging, monitoring.
- **Why it matters:** `src/server.ts` and `src/start.ts` log via
  `console.error`. Cloudflare Worker logs are ephemeral and there is no
  aggregator or search. Incident triage on the custom domain will be
  guesswork.
- **Recommended fix:** Standardise a `logEvent({level, event, ...ctx})`
  helper that emits JSON lines including `route`, `method`, `userId?`,
  `release`, `requestId`. Confirm the Lovable log surface retains at
  least 7 days, otherwise ship logs to R2 daily.
- **Effort:** M.

### H4. Custom domain (lanterna.dk) not connected, but canonical/OG already point to it
- **Area:** Custom domain readiness, HTTPS.
- **Why it matters:** Canonical URLs, sitemap prod host, and JSON-LD all
  claim `https://lanterna.dk`, but the domain is not yet attached to the
  project (`project_urls` lists only the `.lovable.app` hosts). Search
  engines will index a canonical they cannot fetch, and shares to lanterna.dk
  will 404 until the DNS + Lovable custom-domain flow is completed.
- **Recommended fix:** Complete the custom-domain flow in Project
  Settings → Domains (publish first, then add lanterna.dk with the
  provided CNAME/apex records). Verify TLS issued, then flip HSTS from
  `max-age=0` warm-up to full preload.
- **Effort:** S.

### H5. No CDN / cache-control policy on static routes and sitemap
- **Area:** Cache invalidation, CDN configuration.
- **Why it matters:** `/sitemap.xml` claims a 1-hour cache in comments but
  no `Cache-Control` header is set in code (verified — `sitemap[.]xml.ts`
  returns XML only). SSR HTML has no cache headers either. All traffic
  hits the Worker cold. No invalidation story exists for when an import
  completes and movie pages change.
- **Recommended fix:** Set explicit headers per route family:
  `Cache-Control: public, max-age=300, s-maxage=3600, stale-while-revalidate=86400`
  on `/`, `/film/*`, `/biograf/*`, `/by/*`, sitemap. Set `no-store` on
  `/auth`, `/admin/*`, `/api/*`, `/mcp`. On successful import, purge via
  a cache-tag header or manual purge call.
- **Effort:** M.

### H6. `import_jobs` grows unbounded with 20 MB XML rows
- **Area:** Backup strategy, database migrations, import pipeline.
- **Why it matters:** M2 in `SECURITY_AUDIT.md`. Once cron runs daily (C1),
  the table grows ~600 MB/month. Backups inflate proportionally and the
  Supabase project trips storage limits.
- **Recommended fix:** Add a scheduled cleanup migration: null out
  `xml`/`payload` on jobs where `status='completed' AND finished_at < now() - interval '30 days'`,
  and delete failed jobs older than 90 days.
- **Effort:** XS.

---

## Medium

### M1. Prod vs dev configuration is not clearly separated
- **Area:** Production vs development configuration.
- **Why it matters:** `src/lib/config.server.ts` reads a single
  `process.env.NODE_ENV`; there is no distinction between preview and
  production Supabase projects (both point at the same ref). A broken
  migration on preview is a broken migration in production.
- **Recommended fix:** Long-term, split preview from production Supabase
  projects. Short-term, document that preview and production share state
  and gate destructive admin actions with a "confirm production" step.
- **Effort:** L (project split) or XS (documentation).

### M2. `.env` in repo contains project URL / anon key that also live in `client.ts`
- **Area:** Secrets management.
- **Why it matters:** The anon key is public by design, but the duplication
  means rotating the Supabase anon key requires editing both files. No
  drift detection.
- **Recommended fix:** Read only from `import.meta.env.VITE_SUPABASE_*` in
  generated `client.ts`. Do not hand-edit — regenerate via the platform on
  rotation. Confirm no code path reads `SUPABASE_DB_URL` (M6 in security
  audit).
- **Effort:** XS.

### M3. Supabase migrations directory is not the source of truth
- **Area:** Database migrations.
- **Why it matters:** `supabase/config.toml` exists but there is no visible
  `supabase/migrations/` folder tracked in this checkout; schema changes
  are applied via tool calls. A fresh clone cannot reproduce production
  schema, and a full restore would require rerunning every prior chat.
- **Recommended fix:** Export current schema via `pg_dump --schema-only` and
  commit to `supabase/migrations/0000_baseline.sql`. Require future
  migrations to be added as numbered SQL files alongside tool application.
- **Effort:** M.

### M4. Health endpoint returns 503 for stale imports but nothing polls it
- **Area:** Monitoring.
- **Why it matters:** `/api/public/import-health` exists but is not wired to
  any alerting. A silent failure in cron (C1) will not page anyone.
- **Recommended fix:** Hook a free uptime monitor (UptimeRobot / BetterStack)
  to `/api/public/import-health` and to `/` with a 5-min interval. Alert
  on non-200.
- **Effort:** XS.

### M5. Auth email delivery uses the Supabase default sender
- **Area:** Supabase configuration, custom domain.
- **Why it matters:** Password reset / confirmation emails go from a
  `supabase.io` address. On lanterna.dk this is user-hostile and gets
  spam-filtered. `email_domain` tools are available but unused.
- **Recommended fix:** Configure a custom SMTP (Resend/Postmark) and an
  auth email domain (`auth.lanterna.dk`) via `email_domain--setup_email_infra`.
- **Effort:** S.

### M6. No CORS policy on MCP + import endpoints
- **Area:** CDN configuration, security headers.
- **Why it matters:** M4 in `SECURITY_AUDIT.md`. Ambiguous CORS state
  invites accidental cross-origin exposure during future edits.
- **Recommended fix:** Explicit `Access-Control-Allow-Origin` allowlist per
  route family; reject `OPTIONS` on import routes.
- **Effort:** S.

### M7. Import pipeline has no dead-letter or retry policy
- **Area:** Import pipeline deployment, recovery.
- **Why it matters:** A failed batch marks the job `failed` and stops.
  Cron in C1 will simply queue another next day, potentially with the
  same input. No idempotency key at the transport layer.
- **Recommended fix:** Add automatic retry (max 3, exponential backoff)
  inside `.process`, and expose "retry from batch N" in the admin UI.
- **Effort:** M.

---

## Low

### L1. `bunfig.toml` is committed but the platform builds with Vite/npm
- **Area:** Build configuration.
- **Why it matters:** Confuses contributors; harmless at runtime.
- **Recommended fix:** Delete or add a comment clarifying local-only use.
- **Effort:** XS.

### L2. `preview` script uses `vite preview` (SPA) which won't serve server functions
- **Area:** Deployment process.
- **Why it matters:** Not a prod issue, but the script suggests local
  parity that doesn't exist. Reviewers may verify a build that isn't
  representative.
- **Recommended fix:** Replace with a `wrangler dev` or Nitro preview
  command, or remove the script.
- **Effort:** XS.

### L3. `og:image` on root points to a preview-project R2 URL
- **Area:** Custom domain readiness. Duplicate of L1 in security audit.
- **Recommended fix:** Serve from `/og-image.png` at lanterna.dk absolute URL.
- **Effort:** XS.

### L4. No `/robots.txt` update planned for lanterna.dk cutover
- **Area:** Custom domain readiness.
- **Why it matters:** `Sitemap:` line still points at `danish-reel-hub.lovable.app`.
- **Recommended fix:** Change to `https://lanterna.dk/sitemap.xml` at the
  cutover, or make the sitemap URL derive from the request host.
- **Effort:** XS.

### L5. Source maps behavior on production is undocumented
- **Area:** Build configuration, monitoring.
- **Why it matters:** `ERROR_MONITORING.md` claims maps are emitted by
  default via `@lovable.dev/vite-tanstack-config`, but there is no
  verification step in CI.
- **Recommended fix:** Add a post-build check that `dist/**/*.js.map`
  exists.
- **Effort:** XS.

### L6. No documented on-call or incident response
- **Area:** Recovery procedure.
- **Recommended fix:** One-page runbook: who owns the domain, how to
  reach Lovable support, how to pause auth signups, how to rotate
  secrets.
- **Effort:** S.

### L7. Password policy uses Supabase defaults
- **Area:** Supabase configuration. Duplicate L5 in security audit.
- **Effort:** XS.

### L8. `SUPABASE_DB_URL` may still be present as a secret
- **Area:** Secrets management. Duplicate M6 in security audit.
- **Recommended fix:** Confirm nothing reads it (`rg SUPABASE_DB_URL src`
  returns nothing), then delete.
- **Effort:** XS.

---

## Production Readiness Score

**58 / 100**

Breakdown (weighted, out of 100):
- Security posture (headers, secrets, RBAC): 12/20 — RBAC in place, headers/CSP missing.
- Reliability (cron, retries, monitoring alerts): 8/20 — health endpoint exists, nothing polls it.
- Deployability (rollback, release IDs, migration source of truth): 10/20.
- Data safety (backups, PITR, `import_jobs` growth): 8/15.
- Domain & TLS readiness: 10/15 — canonical/SEO ready, domain unconnected.
- Observability (logs, error monitoring): 10/10 — error sink done.

---

## Top 5 Remaining Risks Before Beta

1. **Stale catalog** — no cron runs the importer (C1). Users see 40-day-old data.
2. **Domain cutover breaks canonicals** — lanterna.dk not attached but referenced everywhere (H4).
3. **Unrecoverable auth data loss** — no documented backup/restore for `auth.users` + `user_roles` (C4).
4. **Clickjacking / MITM window on first custom-domain visits** — no HSTS/CSP (C3).
5. **Import secret leak = catalog wipe** — static shared secret, no rate limit, `===` compare (C2).

---

## Recommended Implementation Order

Do in this order; each step unblocks the next.

1. **H2** (release ID) — XS, prereq for meaningful monitoring on every
   later change.
2. **H6** (`import_jobs` cleanup) — XS, avoids DB blowup once cron runs.
3. **C2** (harden import auth: `timingSafeEqual` + rate limit + rotate
   secret) — S, prereq for exposing the endpoint to a scheduler.
4. **C1** (schedule the import via pg_cron) — S, unblocks fresh data.
5. **M4** (uptime + health polling) — XS, catches C1 failures.
6. **C3** (security headers + CSP with HSTS `max-age=0`) — S, warm-up
   before domain cutover.
7. **H4** (attach lanterna.dk, verify TLS, then flip HSTS to full
   preload, then update sitemap host L4 + OG image L3) — S.
8. **H1** (write rollback runbook) + **L6** (incident runbook) — S.
9. **C4** (backup strategy + restore drill) — M.
10. **H3** (structured logging) — M.
11. **H5** (cache-control + purge on import complete) — M.
12. **M3** (commit baseline migration) — M.
13. **M5** (custom SMTP for auth mail) — S.
14. **M1 / M7** (preview↔prod split, import retries) — L, post-beta.
15. **Everything else in Low** — cleanup pass.
