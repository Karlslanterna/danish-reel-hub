# Performance plan — homepage payload, film navigation, mobile benchmark gate

Baseline reviewed at commit `283e6f97`. No code changed.

## What is slow today, and why

`src/routes/index.tsx` → `loadHomeCatalog()` awaits three national queries in parallel
(`fetchMovies()`, `fetchCinemas()`, `fetchShowtimeIndex()` in `src/lib/cinema-data.ts`) and returns
the whole thing as loader data. Because it is loader data, the entire catalogue (612 movies,
195 cinemas, ~17,957 screening index rows) is both awaited before the first byte of HTML and
serialized into the SSR payload, on every cold hit of `/`, `/for-boern`, `/babybio`,
`/seniorbio`, `/filmporten`, `/biografklub-danmark`. The page then only renders 40 movie cards
(`INITIAL_MOVIE_CARD_COUNT`) and 24 cinema cards.

`fetchMovieProgramme()` (`src/lib/cinema-data.ts:680`) awaits `fetchCinemas()` — the full national
cinema list — only to filter it down to the handful of cinemas that show the film. Same in
`fetchCinemasForMovie()` (`:653`).

## Task 1 — Split the homepage into "shell" and "full catalogue"

### New module: `src/lib/home-catalog.ts`
Move `HomeCatalogData`, `compactMovieForHome`, `compactCinemaForHome`, `loadHomeCatalog`,
`loadCachedHomeCatalog` out of `src/routes/index.tsx` (route files should stay thin) and add:

- `type HomeShell = { movies: Movie[]; cinemas: Cinema[]; showtimeIndex: CompactShowtimeIndex; totalMovies: number; totalCinemas: number; complete: boolean }`
- `loadHomeShell(opts: { childrenOnly?: boolean; specialEvent?: SpecialEventTag })` — server-side
  it reuses the same three fetches (they are already TTL-cached in-process by
  `movieListCache` / `cinemaListCache`), applies the route's own children/special-event filter,
  then trims to the first 40 ranked movies and the 24 cinemas rendered above the fold, plus the
  screening-index rows belonging *only* to those movies. `complete: false`.
- `loadFullHomeCatalog()` — the existing `loadHomeCatalog`, unchanged semantics, `complete: true`.

The trim is what removes the payload: the shell serializes ~40 movies + ~24 cinemas + their
screening rows instead of the national index. Ranking/order comes from the same
`movies_ranked` order the unfiltered view already uses, so the first paint is byte-identical in
content to today's first 40 cards.

### Route loaders
`src/routes/index.tsx`, `for-boern.tsx`, `babybio.tsx`, `seniorbio.tsx`, `filmporten.tsx`,
`biografklub-danmark.tsx`: loader returns `await loadHomeShell({...})` only. No deferred promise
in loader data (a streamed promise still blocks/serializes on SSR-heavy paths and complicates the
`head()` contract).

### Client-side completion
In `HomePage` (`src/routes/index.tsx`), replace the `useEffect` that seeds
`HOME_CATALOG_QUERY_KEY` with a `useQuery`:

```
const { data } = useQuery({
  queryKey: HOME_CATALOG_QUERY_KEY,
  queryFn: loadFullHomeCatalog,     // browser-side supabase-js call
  staleTime: 5 * 60 * 1000,
  initialData: shell.complete ? shell : undefined,
})
const catalog = data ?? shell
```
Everything downstream (`screeningsByMovie`, `catalogMovies`, `facets`, `suggestions`,
`matchingScreenings`, `filtered`, `useCinemaUrlSync`) keeps consuming `catalog` unchanged, so
filter/search semantics and `buildFilterFacets` inputs are identical once the catalogue lands.
No change to `src/lib/filters.tsx` persistence, URL sync, or localStorage.

### Behaviour while the catalogue is loading
- `filtersHydrated` in `useFilters()` is already false during SSR; persisted filters are applied
  only after hydration, which is also when the full catalogue request is in flight. Gate the
  filter/search UI on `catalog.complete` **or** keep it enabled but disable the "no results"
  zero-result analytics event until `complete` — otherwise `useTrackZeroResults` /
  `lastZeroResult` will fire false zero-results against the 40-movie shell. This is the single
  most important correctness detail of this task.
- `FilterBar` facet lists must not shrink to shell-only options: render facets from
  `catalog.complete ? facets : previousFacets ?? facets` (or show the filter chips in a
  loading state) so a user cannot select against a partial option set.
- If a persisted filter is active at hydration, keep the shell cards rendered and re-rank when
  the catalogue arrives; do not blank the grid.

### SEO / SSR (task 4)
- `head()` on `/` is static — unaffected.
- `for-boern.tsx` head builds `childrenMoviesSchemas(movies)` and a `noindex` gate from
  `loaderData`; `special-event-seo.ts` does the same for the four event routes. `loadHomeShell`
  must therefore return the route-filtered `totalMovies` count and the *ranked* subset used for
  schema, computed server-side over the full catalogue before trimming. Cap schema items
  (e.g. first 40) — Google does not need 600 ItemList entries and it is pure payload.
- The `noindex, follow` gate keys off `totalMovies === 0`, not `movies.length === 0`.
- Routes, canonicals, breadcrumbs, JSON-LD types unchanged.

## Task 2 — Film navigation should not load all cinemas

`src/lib/cinema-data.ts`:

- `fetchMovieProgramme(movieId)`: drop `fetchCinemas()`. Fetch the showtimes first, collect
  `cinemaId`s, then fetch only those cinemas via a new
  `fetchCinemasByIds(ids: string[])` (`supabase.from("cinemas").select("*").in("id", expandCinemaIds(ids))`)
  that runs the same `consolidatePublicCinemas` + `compactCinemaForListing` mapping as
  `fetchCinemas()` so the returned records are shape-identical. Extract the mapping body of
  `fetchCinemas()` into a shared `mapCinemaRows(rows)` helper used by both.
- `fetchCinemasForMovie(movieId)`: same substitution (it currently calls `fetchCinemas()` at `:673`).
- Keep the `PUBLIC_DATA_CACHE_TTL_MS` in-process cache: if `fetchCinemas()` is already warm,
  `fetchCinemasByIds` should serve from it rather than issue a query (cheap `Map` lookup guard).
- `src/routes/film.$slug.tsx` and `$city.film.$slug.tsx` need no change; `findCachedHomeMovie`
  still works because the homepage shell seeds the same query key — but note the film route can
  now miss the cache when navigation happens before the full catalogue lands. That path already
  falls back to `fetchMovieBySlug`, so it degrades to today's behaviour, not worse.

## Task 3 — Real mobile performance gate

New spec `tests/e2e/performance.spec.ts` (keep `page-speed.spec.ts` as-is; it covers layout and
cache-header policy).

- Project: add a `mobile-perf` Playwright project in `playwright.config.ts` using
  `devices["Pixel 7"]`, plus CPU throttling (`Emulation.setCPUThrottlingRate`, 4x) and network
  throttling (`Network.emulateNetworkConditions`, ~Fast 3G: 1.6 Mbps down, 150 ms RTT) via CDP
  session, so numbers are stable and comparable.
- Cold homepage: `page.goto("/")`, read `PerformanceNavigationTiming` for TTFB, PerformanceObserver
  for `first-contentful-paint` and `largest-contentful-paint`, and sum `transferSize` of all
  resources (`performance.getEntriesByType("resource")` + navigation entry) to get payload bytes.
  Also assert HTML document bytes separately — that is the metric task 1 actually moves.
- Warm navigation: after the homepage settles, click the first `a[href^="/film/"]`, measure time
  to the film `h1` being visible and the bytes transferred during that navigation.
- Budgets, expressed as named constants at the top of the spec so they are reviewable:
  TTFB ≤ 800 ms, FCP ≤ 2.5 s, LCP ≤ 4.0 s, SSR HTML document ≤ 250 KB transferred,
  total cold transfer ≤ 1.5 MB, warm homepage→film ≤ 1.5 s and ≤ 400 KB.
  Numbers get calibrated against a first local run before the gate is turned on; they are
  ceilings, not targets.
- Emit the measurements with `testInfo.attach("metrics", …)` as JSON so CI keeps a trend record.
- CI (`.github/workflows/ci.yml`): run the new project in the pinned official Playwright
  container, non-blocking on PRs (advisory, per the delivery rules — a PR run cannot observe the
  deployed code), blocking in the post-deploy production run against `SMOKE_BASE_URL`.
  Run serially (`workers: 1`) for external targets, which the config already does.

## Hosting caching limitation

Lovable's managed hosting rewrites the browser-facing `Cache-Control` on SSR HTML and forces
revalidation — `tests/e2e/page-speed.spec.ts` already encodes this as an accepted state. So the
homepage cannot be served from a shared edge cache and every cold visit pays a real SSR render.
That is precisely why shrinking the awaited/serialized payload (task 1), not adding cache
directives, is the lever here. The in-process TTL caches (`homeCatalogCache`,
`movieListCache`, `cinemaListCache`) survive only for the lifetime of a worker isolate, so a cold
isolate always re-queries. `CDN-Cache-Control` can be set for an upstream shared cache, but an
actual edge-cache hit must not be claimed without production evidence.

## Test plan

- Unit (`vitest run src`): new tests for `loadHomeShell` (trim size, ranking preserved, children /
  special-event filtering applied before trim, `totalMovies` reflects the full catalogue) and for
  `fetchCinemasByIds` shape-equality with `fetchCinemas()` output for the same ids. Existing
  `filter-facets`, `movie-sort`, `children-filter`, `home-catalog-cache`, `public-catalog` tests
  must stay green untouched.
- SSR assertions: for `/`, `/for-boern`, `/babybio`, `/seniorbio`, `/filmporten`,
  `/biografklub-danmark` — curl the SSR HTML and assert canonical, title, `robots` gate, and
  JSON-LD are unchanged versus baseline; assert document bytes dropped substantially.
- E2E: existing `filters.spec.ts`, `smoke.spec.ts`, `cinema-pages.spec.ts`, `page-speed.spec.ts`
  unchanged and green; add a filter-persistence case that sets a filter, reloads, and asserts the
  same result set after the catalogue completes.
- New `performance.spec.ts` run locally to calibrate, then in CI.
- Manual: throttled mobile check of `/` → film → back, with a persisted city + date filter.

## Likely regressions to watch

1. False zero-result state and false zero-result analytics between hydration and catalogue arrival.
2. Filter/search options briefly limited to the shell's 40 movies / 24 cinemas.
3. `useCinemaUrlSync` receiving a partial cinema list, failing to resolve a `?biograf=` slug on
   first pass — it must re-run when the catalogue completes.
4. Special-event and children `head()` gates flipping to `noindex` if they read the trimmed
   `movies.length` instead of the full-catalogue count.
5. Layout shift / LCP regression if the grid changes height when the catalogue lands — keep the
   first 40 cards stable and append only.
6. Duplicate work: shell + full catalogue means two passes over the data on first visit; the
   query-key seeding must prevent a third fetch on film-page navigation.
7. `fetchCinemasByIds` returning differently-consolidated records than `fetchCinemas()` (multi-source
   cinemas) — hence the shared mapping helper and the shape-equality test.

## Delivery

Branch `agent/perf-home-shell`, one commit, draft PR with root cause, measurements before/after,
and validation evidence. No database schema changes.
