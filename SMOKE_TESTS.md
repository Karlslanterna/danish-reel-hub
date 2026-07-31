# Smoke Tests

Production-ready end-to-end smoke suite for Lanterna, built with
**Playwright** (`@playwright/test`). These tests answer one question only:
*is the deployment functional?* They do not assert styling, layout, copy, or
visual appearance.

- Config: `playwright.config.ts`
- Specs: `tests/e2e/smoke.spec.ts`
- Shared helpers: `tests/e2e/helpers.ts`

## Test coverage

| # | Test | What it proves |
|---|------|----------------|
| 1 | Homepage loads | `/` returns 200, renders an `<h1>` and the search input |
| 2 | Movie page loads | A real `/film/:slug` from the sitemap returns 200 and renders |
| 3 | Cinema page loads | A real `/biograf/:slug` returns 200 and renders |
| 4 | City page loads | A real `/by/:city` returns 200 and renders |
| 5 | Search returns results | Typing a term derived from a real movie title yields suggestion options |
| 6 | `/sitemap.xml` | HTTP 200 and a `<urlset>` root element |
| 7 | `/robots.txt` | HTTP 200 and a `User-agent` directive |
| 8 | `/api/public/import-health` | HTTP 200 (healthy/warning) **or** 503 (critical), always valid JSON with a known `status`; 503 must map to `critical` |
| 9 | Auth page loads | `/auth` returns 200 and renders a sign-in control |
| 10a | Admin denied when signed out | `/admin/import` redirects an unauthenticated visitor to `/auth` |
| 10b | Admin allowed when signed in | With an injected admin session, `/admin/import` renders and the URL stays put |

### Determinism notes

- **No hard-coded slugs.** Movie / cinema / city URLs are discovered from
  `/sitemap.xml` at run time and cached per worker, so a changing catalog never
  breaks the suite. If the catalog is empty, the failure message says so
  explicitly rather than failing on a missing element.
- **Search term is derived** from the movie page's own `<h1>`, so the query is
  guaranteed to match something.
- **Hydration-safe.** The search assertion re-types the term until the client
  has hydrated (polled, 15 s cap) instead of racing a single keystroke.
- **Shared helpers** (`expectPageLoads`, `firstPathFor`, `getSitemapUrls`,
  `restoreSupabaseSession`) keep the specs free of duplication, and every
  assertion carries a message naming the URL and the expectation.
- Test 10b **skips with an explanatory message** when no admin session is
  available, so unauthenticated CI runs stay green instead of flaking.

## How to execute locally

```bash
# once, to fetch the browser
npx playwright install chromium

# run the suite (starts / reuses the dev server on :8080 automatically)
bun run test:smoke

# single test, headed debugging, or the UI runner
npx playwright test -g "homepage"
bun run test:smoke:ui
```

If the sandbox / CI image lacks Chromium's system libraries, point the runner
at a system browser instead of the bundled download:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium bun run test:smoke
```

## How to execute before deployment

Run against the built app or a deployed URL — `SMOKE_BASE_URL` disables the
local dev-server startup:

```bash
# against a production build served locally
bun run build && bun run preview &
SMOKE_BASE_URL=http://localhost:4173 npx playwright test

# against the preview deployment
SMOKE_BASE_URL=https://danish-reel-hub.lovable.app npx playwright test

# against production after release
SMOKE_BASE_URL=https://lanterna.dk npx playwright test
```

Add admin coverage (test 10b) by exporting the Supabase session variables
(`LOVABLE_BROWSER_SUPABASE_STORAGE_KEY`, `LOVABLE_BROWSER_SUPABASE_SESSION_JSON`,
optionally `LOVABLE_BROWSER_SUPABASE_COOKIES_JSON`) for an account holding the
`admin` role. Never commit these values.

Recommended gate: **block the release if any smoke test fails.** A 503 from
`/api/public/import-health` does *not* fail the suite (it is a valid state) —
alerting on stale imports belongs to monitoring, see `IMPORT_HEALTH.md`.

## Expected execution time

- Full suite, 4 workers, warm dev server: **~11–15 seconds**
- Cold start (dev server boot included): **~45–60 seconds**
- Per-test timeout: 30 s; per-assertion timeout: 10 s; 1 retry in CI

## Explicitly out of scope (belongs in the full regression suite)

These are valuable but too slow, stateful, or data-dependent for smoke:

- Filter behaviour: radius / geolocation permission flows, date presets, the
  swipeable calendar, "Ryd filtre", and filter persistence across routes.
- Full search semantics: city aggregation across postcodes, director and genre
  matching, keyboard navigation and Enter-to-navigate.
- Ticket links: per-showtime `ticket_urls` correctness against the source data.
- Import pipeline: XML parsing, dedup / merge rules, upserts, background job
  progression (queued → running → completed → failed), and job status polling.
- Import health state machine: threshold crossings and transition logging.
- Auth lifecycle: sign-up, email confirmation, Google OAuth, sign-out, session
  refresh, redirect-loop regressions, non-admin authenticated users hitting
  `/admin/*`.
- MCP server: OAuth 2.1 handshake, tool listing and tool invocation.
- SEO details: canonical tags, JSON-LD payload validation, OG/Twitter metadata,
  breadcrumbs, `noindex` headers.
- 404 / error handling for unknown slugs, error boundaries, error reporting.
- Performance and Core Web Vitals, accessibility audits, cross-browser
  (Firefox/WebKit) and mobile viewport runs.
