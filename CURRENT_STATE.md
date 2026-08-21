# Lanterna current state — verified 2026-08-21

> **Purpose:** orientation snapshot for future work across chats/agents. This is not a second rulebook and it is not runtime truth forever.
>
> **Verified baseline:** production `https://lanterna.dk/` and `main` commit `b506edbfc567c1877bd1fd797cf839814d0a3da3` during the 2026-08-21 system audit.
>
> **Before relying on mutable facts** (imports, counts, performance, current programmes, deployed revision), re-check production and the current `main` branch.

## Authority and document order

1. `AGENTS.md` — delivery/process/security rules.
2. `MISTAKES.md` — known failure modes that must not recur.
3. `FILTER_PRINCIPLES.md` — product/filter semantics.
4. This file — current architecture, verified capabilities, known gaps and audit orientation.
5. Older audits/reviews — historical context only unless re-verified against current code and production.

In particular, `SEO_ARCHITECTURE_REVIEW.md`, `TECHNICAL_SEO_AUDIT.md` and `SECURITY_AUDIT.md` contain historical findings that have since been implemented or superseded. Do not treat their old “missing” lists as current backlog without re-checking code and production.

## Production architecture

- Public site: `https://lanterna.dk/`.
- Repository: `Karlslanterna/danish-reel-hub`.
- Lovable project: `064d1982-2d69-459e-a2f3-a9c092d237c3`.
- Supabase production data must only be accessed through Lovable's connected project.
- Canonical showtime read model: `public.screenings`; legacy `showtimes` is compatibility/parity only.
- Current sources: Kultunaut + eBillet.
- Known physical-cinema aliases are consolidated in `src/lib/cinema-catalog.ts`.
- Public film duplicates are consolidated in `src/lib/public-catalog.ts`.

## Public product — verified working

The 2026-08-21 audit exercised the production user flows in Chromium and WebKit with an iPhone profile. The relevant suite passed in both engines.

Verified public behaviours include:

- homepage renders a bounded first batch and progressively reveals the catalogue;
- search returns a known current film;
- film, cinema and city pages load and remain navigable;
- eBillet ticket buttons resolve through the current route without the old generic failure;
- distance filtering works on first interaction, expands correctly by radius and discards stale persisted geolocation;
- shared filters survive film/cinema navigation and can be removed in one press;
- children and time filters behave consistently;
- city-specific children routes are canonical and responsive;
- cinema programmes are ordered and do not overflow on mobile;
- `/robots.txt`, sitemap index and import-health endpoint respond correctly;
- unauthenticated users cannot open admin import routes;
- cinema×movie SEO pages are live, self-canonical when they have current showtimes and linked from their parent pages.

The authenticated admin smoke remains environment-limited because CI does not currently supply an authenticated admin session.

## Current route/SEO architecture

The current indexable architecture is materially ahead of the older SEO review:

- `/` — national discovery homepage.
- `/film` — national crawlable film index.
- `/film/{movie}` — national film page.
- `/biograf` — national crawlable cinema index.
- `/biograf/{cinema}` — cinema page.
- `/{city}` — city hub containing both current films and a “Biografer i {city}” section. **Do not create a duplicate `/{city}/biografer` layer unless a future audit demonstrates distinct user/search value.**
- `/{city}/film/{movie}` — city×movie page, self-canonical only with current local showtimes; otherwise noindex/canonical up.
- `/biograf/{cinema}/film/{movie}` — cinema×movie page, self-canonical only with current showtimes; otherwise noindex/canonical up.
- `/for-boern` and the four public special programmes (`/babybio`, `/seniorbio`, `/filmporten`, `/biografklub-danmark`).

SEO infrastructure currently includes:

- robots/noindex protection for private/API/MCP areas;
- split sitemap index with core, movie, cinema, city×movie and cinema×movie sitemaps;
- sitemap entries derived from current canonical screenings and showtime-derived `lastmod`;
- sitewide footer/internal hub links;
- canonical URLs and thin-content guards;
- WebSite/Organization, Movie, MovieTheater, ScreeningEvent, CollectionPage, ItemList and Breadcrumb JSON-LD in the relevant layers.

Remaining SEO work is mostly refinement rather than missing architecture:

- national `/film/{movie}` currently builds its JSON-LD without the deferred programme, so representative `ScreeningEvent` objects are absent there even though city×movie/cinema×movie pages contain them;
- structured-data enrichment such as `endDate`, `eventStatus`, `eventAttendanceMode`, reliable language/format fields, and additional MovieTheater contact/opening data can be added only where the underlying data is trustworthy;
- `/film` has grown enough that performance/crawl-friendly pagination or bounded rendering is now warranted;
- Google Search Console outcome/rankings are still too young to judge; do not treat early non-indexing as proof of a technical defect without current GSC evidence.

## Data and information quality

### Current freshness snapshot

At audit time on 2026-08-21:

- Kultunaut had a successful canonical import completed the same morning.
- eBillet had a successful recovered canonical cycle with all 89 organizers completed, 0 queued, 0 running and 0 dead-lettered.
- Both sources supplied roughly one month of forward coverage.
- The public 30-day screening set contained roughly 20.9k source screening rows (about 6.7k eBillet + 14.2k Kultunaut).
- malformed canonical screening rows: 0 in the production catalogue audit.
- canonical/legacy parity mismatch count: 0 in the production parity audit.

These numbers are a dated snapshot; re-query production before reporting them later.

### Source noise vs public product

Raw sources still contain programme shells/non-film titles such as generic special arrangements, closure notices and food/event entries. This is expected upstream noise. Public movie reads apply `isPublicMovieTitle` filtering and the rendered homepage audit was clean. Do not report a raw source title as a visible bug until its public route/search/card exposure has been verified.

Metadata is uneven across individual source records. Public consolidation deliberately merges compatible eBillet/Kultunaut film identities and selects the strongest metadata. Missing fields in raw source rows therefore do not equal missing fields on the public consolidated film. Remaining gaps should be classified as either:

- **correctness defect** — wrong title/movie identity/time/cinema/ticket destination;
- **enrichment gap** — correct entity/showtimes but missing synopsis/poster/runtime/director/genre.

Treat the first class as higher priority.

### Cinema geodata

Known Danish source aliases are consolidated to geocoded physical cinemas. At the audit snapshot the unmatched active no-coordinate venues were Katuaq (Nuuk), Sisimiuni Kulturhus (Sisimiut) and Havnar Bio (Tórshavn); no unmatched active Danish venue remained in that category. Re-check before making future completeness claims.

### Important unresolved counting issue

The canonical `screenings` table can contain the same physical screening from both sources. UI grouping generally collapses identical times after movie/cinema consolidation, so this is not equivalent to visible duplicate buttons.

However, `movies_ranked.screening_count` counts source rows and the default public sort is “most screenings”. The audit found about 1.5k cross-source same-movie/same-physical-cinema/same-start duplicate groups in the 30-day window, plus a small number of same-source duplicates. This can inflate default popularity/ranking and any raw “screening count” metric.

**Do not treat raw `screening_count` as a physical-show count.** A future fix should define a canonical physical-screening identity after cinema/movie consolidation and use that count for ranking/counters.

## Special filters

Public special filters remain deliberately limited to Babybio, Seniorbio, Filmporten and Biografklub Danmark.

- Babybio/Seniorbio are screening attributes; never infer from time alone.
- Filmporten/Biografklub Danmark are curated programmes; keep dated official-programme validation.
- During the 2026-08-21 audit the current Filmporten and Biografklub Danmark tagged titles matched their official current programmes, and an Empire Babybio sample matched explicit source tags. This is a dated check, not a permanent whitelist.

## Import and scheduler operations

### Current cron topology

At the audit snapshot:

- Kultunaut daily start: 02:00 UTC.
- Kultunaut resume: every 2 minutes in its configured processing window.
- eBillet daily start: 01:00 UTC.
- eBillet retry: 01:10 UTC.
- eBillet resume: every 5 minutes.

### Critical observability rule

**`cron.job_run_details.status = succeeded` is not proof that a scheduled import endpoint succeeded.** The cron SQL queues `net.http_post`; the actual HTTP request happens asynchronously. Therefore a green pg_cron row proves dispatch/queueing, not application-level import completion.

This distinction was operationally material: eBillet had become stale while scheduler infrastructure appeared healthy, and Kultunaut had a cron dispatch day without a corresponding application-level schedule run.

For import truth use, in order:

1. current canonical `import_runs` / source-specific run state;
2. `import_schedule_runs` where applicable;
3. canonical screening freshness/horizon and source counts;
4. `/api/public/import-health`;
5. pg_cron only as evidence that the dispatch SQL fired.

A reliable monitoring setup should page on application-level stale/critical health, not pg_cron success alone.

### Orphan run debt

One old Kultunaut canonical run from 2026-08-17 remained `queued` with an old `movies_slug_key` error although newer imports succeeded. It does not currently block public data, but stale nonterminal runs should be terminalized/cleaned by policy so admin/health state cannot accumulate misleading debris.

### Migration-history caveat

The production `supabase_migrations.schema_migrations` ledger did not enumerate every repo migration whose effects are visibly present at runtime (for example current analytics/showtime RPC/retry infrastructure). Do not conclude “migration is not applied” from the ledger alone, and do not conclude “migration history is healthy” from runtime objects alone.

This is deployment/recovery debt: future work should reconcile how migrations applied through direct/Lovable production operations are recorded so a clean rebuild has an auditable history.

## Performance

The existing hard performance gate models a 390×844 mobile device, ~1.6 Mbps down, 150 ms latency and 4× CPU slowdown. It currently measures the homepage cold load plus warm film navigation. Homepage server TTFB varies materially between runs, so one sample should not be interpreted as a stable regression without repeated evidence.

A wider route-family audit on 2026-08-21 found these important issues:

- `/for-boern` is materially slower on a fresh mobile context because its loader waits for the full national catalogue before first render. One audit sample: H1 ~11.3 s, TTFB ~2.63 s, FCP ~3.58 s, LCP ~4.18 s, ~1.77 MB transferred.
- `/film` renders the complete active film index and has become heavy. One sample: ~4.14 MB transferred and LCP ~4.87 s.
- lightweight routes such as `/biograf` and cinema×movie pages were substantially faster in the same profile.
- a sample national movie detail had good H1/FCP but LCP >5 s, indicating hero/poster/backdrop loading deserves route-specific follow-up.

Exact timings are volatile production samples, not permanent budgets. The architectural conclusions (full-catalogue blocking on `/for-boern`; unbounded `/film`) are code-backed and should be fixed even if a later timing sample is faster.

Likely next performance work:

- give `/for-boern` and special-programme pages bounded/targeted initial data instead of awaiting the full home catalogue;
- paginate or otherwise bound `/film` while keeping crawlable links and self-canonicals;
- keep a route-family performance matrix in CI, but use stable budgets/multiple samples rather than overreacting to one cold-origin TTFB spike.

## Security and privacy

Current server responses include HSTS on HTTPS, nosniff, frame denial, strict referrer policy, permissions policy and COOP. Private/API/MCP routes receive noindex handling. Admin data changes require authenticated/admin authorization and RLS protects private tables.

Remaining hardening work:

- Content-Security-Policy is still absent; add only after enumerating required origins/resources so production is not broken by a guessed policy.
- MCP has OAuth but no explicit application rate limiter; add per-user/token throttling if agent traffic becomes material.
- MCP tool error responses should avoid returning raw backend error strings.
- `npm ci` currently reports dependency audit findings; treat them as **untriaged dependency findings**, not automatically exploitable production vulnerabilities, until the dependency paths and runtime exposure are reviewed.

Analytics is same-origin and anonymous by design. Admin exposes a browser opt-out (“Tæl ikke denne browser med”), and the current event model tracks page/filter/zero-result/ticket interactions rather than personal identities.

## MCP / agent data surface

The web UI uses the curated public data model, but the MCP tools are older and do not fully mirror it. As of this audit:

- movie search reads raw movie rows rather than the full public non-film/active/consolidation model;
- cinema search can expose raw source identities rather than canonical physical cinemas;
- showtime lookup does not consistently apply the same future-window and source-alias expansion as public film/cinema pages.

If MCP is a supported product surface, align it with the same public catalogue helpers before expanding usage. These issues do not imply the normal website is wrong.

## Test coverage and known blind spots

The audit-only WebKit run demonstrated that current critical public flows work in both Chromium and an iPhone-profile WebKit browser. Do not merge the entire duplicated audit suite merely because it passed; a permanent, smaller WebKit critical-flow gate is preferable to doubling every smoke test indefinitely.

Still missing from automated release confidence:

- authenticated admin flow under a real admin session;
- systematic accessibility audit (keyboard/focus/labels/contrast/axe-style rules);
- broad internal broken-link crawl;
- persistent route-family performance budgets beyond the homepage;
- automated upstream source-vs-Lanterna spot validation for representative screenings.

## Prioritized open work from the 2026-08-21 system audit

### P1 — correctness, user speed and operations

1. Replace raw source-row `screening_count` with a physical-screening count for default ranking/counters.
2. Remove full-catalogue blocking from `/for-boern` and special-programme first loads.
3. Bound/paginate `/film`; the old “pagination not needed” conclusion is no longer valid at current catalogue size.
4. Make import monitoring application-level: stale/critical alerting and a guarded Kultunaut recovery strategy. Do not add a blind second daily full import.
5. Reconcile production migration history/runtime state so applied database changes have an auditable ledger.

### P2 — quality and coverage

1. Follow up movie-detail LCP and other heavy city/special routes from the route-family matrix.
2. Align MCP search/showtime tools with the canonical public movie/cinema/screening model.
3. Add representative ScreeningEvent JSON-LD to national movie pages without making their SSR path heavy.
4. Triage dependency audit findings; then decide CSP/rate-limit hardening based on actual exposure.
5. Improve film metadata enrichment where the consolidated public record is genuinely thin.
6. Add a narrow permanent WebKit critical-flow gate and authenticated-admin CI smoke when credentials/session provisioning is safe.

### P3 — maintenance/polish

1. Clean/terminalize stale orphan import runs and set retention policies for legacy run payloads.
2. Make root 404/error UI Danish.
3. Run a dedicated accessibility audit.
4. Add `/mcp` to the static robots disallow list as crawl-waste polish (server noindex already protects indexing).
5. Continue structured-data enrichment only from reliable data.

## Starting a future work session safely

Before making broad changes to SEO, imports, filters, performance or data:

1. Read `AGENTS.md`, `MISTAKES.md`, `FILTER_PRINCIPLES.md`, then this file.
2. Fetch current `main` and compare it with the verified commit above.
3. Verify the actual deployed Lovable revision before assuming main is live.
4. Re-query mutable production facts through Lovable's connected database.
5. Run/inspect the relevant production audit, parity, smoke and performance jobs.
6. Treat older audit documents as historical unless a finding is confirmed in current code/runtime.

When this snapshot becomes materially stale, update this one file rather than creating another competing “current state” document.
