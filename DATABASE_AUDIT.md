# Database & Data Access Audit — Lanterna

Scope: read-only analysis of every Supabase query, index, constraint, cache
config, and access pattern in the codebase. No behavioural changes proposed.

Target scale used throughout: **1,000 movies, 500 cinemas, 100,000 showtimes**.

---

## Summary of severities

| # | Finding | Severity |
|---|---|---|
| 1 | Homepage loader fetches the entire `showtimes` table (`select *`) on every visit | **Critical** |
| 2 | `fetchMovieCinemaPairs` scans all 100k showtimes for the homepage | **Critical** |
| 3 | `/by/$city` loader triggers N+1 (`fetchMoviesForCinema` per cinema) + full showtimes scan | **Critical** |
| 4 | `/biograf/$slug` loader triggers N+1 (`fetchShowtimesForMovie` per movie) | **High** |
| 5 | Missing composite index `showtimes(movie_id, date)` / `showtimes(cinema_id, date)` | **High** |
| 6 | React Query defaults: no `staleTime`/`gcTime`, no loader→cache priming | **High** |
| 7 | Route loaders bypass React Query entirely (every navigation re-fetches) | **High** |
| 8 | Ubiquitous `select("*")` in `src/lib/cinema-data.ts` — ships unused columns (posters JSON, synopsis, etc.) | **Medium** |
| 9 | No index on `showtimes(date)` — date filters (a core UI feature) scan the table | **Medium** |
| 10 | No index on `cinemas(city)` — city landing pages scan all cinemas | **Low** |
| 11 | Import job uses per-row `insert` in a loop (up to 100k round-trips) | **Medium** |
| 12 | Ambiguous denormalisation: both `booking_url`/`ticket_url` and `ticket_urls[]` are read | **Low (correctness risk)** |
| 13 | FK cascade rules are correct; no missing FKs | **OK** |

---

## 1. `select("*")` occurrences

All non-explicit selects live in `src/lib/cinema-data.ts`:

| Line | Call | Replace with |
|---|---|---|
| 122 | `movies.select("*").order("title")` | `id, slug, title, original_title, runtime, genre, year, director, rating, synopsis, poster` (drop `external_id`, `release_date`, `trailer_url`, `created_at`) |
| 128 | `cinemas.select("*").order("name")` | `id, slug, name, city, address, description, screens, latitude, longitude` (drop `external_id`, `website`, `created_at`) |
| 134 | `movies.select("*").eq(slug)` | same movie projection as above |
| 140 | `cinemas.select("*").eq(slug)` | same cinema projection as above; add `website` for the detail page |
| 148 | `showtimes.select("*").eq(movie_id)` | `movie_id, cinema_id, date, times, hall, booking_url, ticket_url, ticket_urls` |
| 157 | `showtimes.select("movie_id, movies(*)")` | `movie_id, movies(<movie projection>)` |
| 173 | `showtimes.select("cinema_id, cinemas(*)")` | `cinema_id, cinemas(<cinema projection>)` |
| 199 | `showtimes.select("*")` (homepage) | see finding #1 — do not fetch at all |

`src/lib/kultunaut/import.server.ts:93` uses `select("*")` on `import_jobs`
— acceptable (server-side admin path, single row).

**Impact:** removes the `poster` (JSON up to a few KB) and `synopsis` payload
from the movie list, and drops unused columns everywhere. At 1k movies that
is a >50% payload reduction on the movies list; at 100k showtimes, dropping
`created_at` + `id` + `external_id` + `start_time` is ~30% wire size.

**Fix:** define one `MOVIE_COLUMNS`, `CINEMA_COLUMNS`, `SHOWTIME_COLUMNS`
constant and reuse.

---

## 2. Homepage fetches the entire showtimes table

`src/routes/index.tsx:11`:

```ts
const [movies, cinemas, pairs, showtimes] = await Promise.all([
  fetchMovies(), fetchCinemas(), fetchMovieCinemaPairs(), fetchShowtimes(),
]);
```

- `fetchShowtimes()` → `select("*") FROM showtimes` — **~100k rows per visit**.
- `fetchMovieCinemaPairs()` → `select("movie_id, cinema_id") FROM showtimes` —
  a second full scan of the same table.

**Severity:** Critical. This is the landing page; every SSR render and every
client navigation currently pulls the entire showtimes table twice.

**Fix (behaviour-preserving):**
1. Collapse `fetchMovieCinemaPairs` + `fetchShowtimes` into a single query
   selecting the columns the homepage actually needs
   (`movie_id, cinema_id, date, times, hall, booking_url, ticket_url, ticket_urls`).
2. Filter server-side by `date >= today` — the UI never shows past dates
   (past dates are disabled in the "Dato" calendar and past showtimes are
   already filtered client-side). At the target scale this drops the working
   set to ~2 weeks × showtimes/day (~10–20k rows worst case, typically <5k).
3. Long-term: expose a Postgres RPC or materialised view of
   `(movie_id, cinema_id, next_showtime_date)` so the homepage does
   `≤ movies + cinemas + upcoming_pairs` rows.

**Expected impact:** 90%+ reduction in transferred bytes, homepage TTFB
from seconds to <200 ms at 100k showtimes.

---

## 3. N+1 in `/by/$city` loader

`src/routes/by.$city.tsx:24`:

```ts
const movieLists = await Promise.all(cinemas.map((c) => fetchMoviesForCinema(c.id)));
const showtimes = await fetchShowtimes(); // full table
```

- One query per cinema in the city (e.g. København = 20+ cinemas → 20+
  round-trips), each doing a nested `movies(*)` join.
- Then another full `showtimes` scan.

**Severity:** Critical.

**Fix:**
- Single query: `showtimes.select("movie_id, cinema_id, date, times, hall, booking_url, ticket_url, ticket_urls, movies(<projection>)").in("cinema_id", cinemaIds)`
  filtered by `date >= today`. Deduplicate movies client-side (already the
  pattern in `fetchMoviesForCinema`).

**Expected impact:** 20–50× fewer round-trips per city page; response size
drops proportionally to date-filtered showtimes.

---

## 4. N+1 in `/biograf/$slug` loader

`src/routes/biograf.$slug.tsx:20`:

```ts
const showtimeLists = await Promise.all(movies.map((m) => fetchShowtimesForMovie(m.id)));
```

Each movie showing at that cinema triggers an independent showtimes query.
At 30 movies per cinema → 30 round-trips.

**Fix:** one query `showtimes.select(<cols>).eq("cinema_id", cinema.id).gte("date", today)`;
group by `movie_id` in memory. Already-known cinema, so we don't need the
join.

**Expected impact:** 30× fewer round-trips per cinema page.

---

## 5. Missing composite indexes on `showtimes`

Current indexes: `movie_id`, `cinema_id`, `start_time`, `external_id`, PK.

Queries observed (or added by finding #2–#4):
- `WHERE movie_id = ? AND date >= ?`
- `WHERE cinema_id = ? AND date >= ?`
- `WHERE date = ?` (MCP `get_showtimes`)
- `WHERE cinema_id IN (…) AND date >= ?` (city pages)

**Missing:**
- `CREATE INDEX ON showtimes (movie_id, date);`
- `CREATE INDEX ON showtimes (cinema_id, date);`
- `CREATE INDEX ON showtimes (date);` — or make the two composite indexes
  cover this via a leading-column probe (Postgres will not use them for a
  `date`-only predicate).

**Severity:** High at 100k rows — without composites, every filtered read
falls back to a bitmap scan over the single-column index and then filters
in memory.

**Expected impact:** filtered reads drop from O(rows-per-movie) to
O(matching rows), typically 100–500× faster once `date` filtering is added
per finding #2.

---

## 6. React Query configuration

`src/router.tsx:6`:

```ts
const queryClient = new QueryClient(); // no defaults
```

- No `staleTime` → every mount refetches.
- No `gcTime` → cache evicted after 5 min default.
- No `refetchOnWindowFocus: false` → tab focus retriggers homepage full scan.

**Recommended defaults** (behaviour-preserving for static-ish content):

```ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,       // 5 min — matches import cadence
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
```

**Severity:** High — combined with finding #7 this is what makes every
navigation re-hit the DB.

---

## 7. Loaders do not prime React Query

Every route uses raw `loader: async () => { … }` returning data, and
components read `Route.useLoaderData()`. React Query is installed and
provided at the root but is not participating in caching for any route.

**Recommended pattern (per project guidance
`tanstack-query-integration`):**

```ts
const homeQO = queryOptions({ queryKey: ["home"], queryFn: fetchHome });

export const Route = createFileRoute("/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(homeQO),
  component: () => useSuspenseQuery(homeQO).data ...
});
```

**Impact:** with `staleTime` from #6, in-session navigations back to the
homepage / a film page become cache hits; only the first visit hits the DB.

---

## 8. Wire-payload columns not needed by callers

Beyond finding #1, `fetchMovies` returns `poster` (JSON blob) and
`synopsis` for every card on the homepage, even though the card only
renders title, poster URL, and runtime. Splitting a `fetchMovieCards`
projection (id, slug, title, runtime, genre, year, poster) from a
`fetchMovieDetail` projection (adds synopsis, director, rating, original_title)
would halve the list payload at 1k movies.

**Severity:** Medium. **Impact:** ~50% payload reduction on `/`.

---

## 9. Missing `showtimes(date)` index

The MCP `get_showtimes` tool and (once #2 is applied) the homepage all
filter by `date`. Currently no index exists. At 100k rows with a typical
2-week horizon (~2k rows/day), a bitmap scan on `date` is unavoidable.

**Fix:** `CREATE INDEX ON showtimes (date);` — cheap, high-value.

Alternative: change `date TEXT` → `date DATE` and add a functional index
on `(date::date)`. `date` being `TEXT NOT NULL` (see schema) is a
correctness smell — sortable only because of ISO-8601 formatting, silently
accepts any string. Out of scope for this "no behaviour change" audit but
worth flagging.

---

## 10. Missing `cinemas(city)` index

`/by/$city` filters cinemas by `city` (client-side today; will become a
server filter per finding #3). Add:

```sql
CREATE INDEX ON cinemas (city);
```

At 500 cinemas the sequential scan is trivial today (~few ms), but the
index removes it and enables future `ILIKE` search patterns cheaply.

---

## 11. Import path has row-by-row `insert` loop

`src/lib/kultunaut/import.server.ts:387`:

```ts
const { error } = await supabaseAdmin.from("showtimes").insert({ … })  // inside a per-row loop
```

At 100k showtimes this means 100k HTTP round-trips per import.

**Fix:** batch (e.g. 500 rows per `insert(rows)` call) and let the existing
job/cursor mechanism drive pagination. **Impact:** import time drops from
tens of minutes to under a minute.

Out of scope if "no behaviour change" is strict — flagged as safe: `insert(rows[])`
is semantically identical to `insert(row)` looped.

---

## 12. `booking_url` / `ticket_url` / `ticket_urls` overlap

`mapShowtime` reads `booking_url ?? ticket_url ?? null` and separately
`ticket_urls`. Three columns model the same concept. Not a performance
issue but a bug magnet — a future importer that writes only `ticket_urls`
will silently break UIs that read `booking_url`. Consolidate to
`ticket_urls[]` (nullable) and derive the "primary" URL in code.

---

## 13. Foreign keys & cascades

```
showtimes.movie_id  → movies.id   ON DELETE CASCADE
showtimes.cinema_id → cinemas.id  ON DELETE CASCADE
```

Correct and desired: deleting a movie or cinema cleans up its showtimes.
No missing FKs (all `movie_id` / `cinema_id` references are constrained).
No orphan risk. Unique constraints on `movies.slug`, `movies.external_id`
(partial), `cinemas.slug`, `showtimes.external_id` (partial) all match
importer upsert keys.

Nothing to change here.

---

## Recommended fix order (safe, no behaviour change)

1. **Indexes** (single migration): `showtimes(movie_id, date)`,
   `showtimes(cinema_id, date)`, `showtimes(date)`, `cinemas(city)`.
2. **Explicit projections** in `src/lib/cinema-data.ts` (findings #1, #8).
3. **Homepage query consolidation** (finding #2) — drop
   `fetchMovieCinemaPairs` + `fetchShowtimes`, replace with a single
   date-filtered fetch.
4. **De-N+1** `/biograf/$slug` and `/by/$city` loaders (findings #3, #4).
5. **React Query defaults + loader priming** (findings #6, #7).
6. Optional: batch importer inserts (finding #11).

Findings #1–#5 alone take the homepage from **~200k rows / multi-second
SSR** to **<10k rows / <200 ms** at the target scale.
