# Kultunaut Import Pipeline — QA Validation Report

Date: 2026-08-13 · Environment: preview/dev against production database
Method: live feed fetch → real parse → real background import job (drained
to completion) → database + homepage audit. No feature code was changed.

---

## Summary table

| # | Check | Result |
| --- | --- | --- |
| 1 | Full import executed | **PASS** (job completed, 39 batches) |
| 2 | Feed fetch | **PASS** (HTTP 200, 1.27 MB) |
| 3 | Parsing without errors | **PASS** (165 ms, 0 errors) |
| 4 | Counts imported | **PASS** (133 movies / 158 cinemas / 3 517 showtime rows) |
| 5 | Duplicates in database | **PASS** (0 dup movies / cinemas / showtimes) |
| 6 | Required fields | **WARNING** (runtime, year, poster gaps) |
| 7 | Poster URLs / malformed data | **WARNING** (all posters are `http://`) |
| 8 | Old showtimes cleaned up | **FAIL** (2 942 obsolete June rows still present) |
| 9 | Homepage reads imported data | **PASS** for data, **WARNING** for stale titles |
| 10 | Scheduled (automatic) imports | **FAIL** (feed URL secret invalid + stuck job) |

---

## 1–3. Fetch and parse

- `GET https://www.kultunaut.dk/perl/export/kalorius.xml` with
  `User-Agent: KarlVictor` → **HTTP 200**, 1 266 164 bytes, 0.66 s.
- Parse: **165 ms**, no exceptions.
- Parsed: **133 movies**, **158 cinemas**, **6 460 `<time>` entries** →
  **3 582 grouped showtime rows**, dates 2026-08-13 → 2026-08-16 (4 days).
- Referential integrity in the feed: 0 showtimes pointing at an unknown
  movie or cinema; 0 malformed times; 0 missing ticket URLs.

## 4. Import result (real run, job `f8f184f4…`)

Completed with status `completed`, phase `done`. Database after the run:

| Table | Before | After |
| --- | --- | --- |
| movies | 109 | 211 |
| cinemas | 159 | 159 |
| showtimes | 2 942 | 6 459 |

3 517 new showtime rows were written (65 fewer than the 3 582 parsed groups —
consistent with the same-title movie merge re-pointing showtimes). The
*added* content is correct; the growth in `movies` is entirely stale data
that was never removed (see item 8).

## 5. Duplicates — PASS

- Duplicate `external_id` in movies: **0**
- Duplicate movie titles (ignoring trailing `(YYYY)`): **0** — the merge
  logic correctly collapsed the 5 duplicate-title pairs present in the feed
  (The Odyssey, Obsession, Dobbeltspil, Michael, Vaiana – DK tale).
- Duplicate cinemas (name + city): **0**
- Duplicate showtimes (movie, cinema, date, hall): **0**
- Orphaned showtimes (missing movie or cinema): **0**

## 6. Required fields — WARNING

Movies (211 rows): title missing **0**; runtime missing/0 **55**;
release year missing/0 **30**; poster URL missing **27**; genre missing 0.
In the current feed alone: 36 of 133 lack runtime, 23 lack year, 20 lack a
poster, 5 lack a synopsis. These are gaps in the source feed, not parser
bugs — but they render as "0t 0m" on the homepage.

Cinemas: name, city, address, latitude/longitude — **0 missing**. 
Showtimes: times **0 missing**, ticket URLs **0 missing**.

## 7. Poster URLs / malformed data — WARNING

- 20 sampled poster URLs all returned **HTTP 200** — no broken images.
- **All poster URLs use `http://`**, not `https://`. On the HTTPS
  production site these are mixed content and may be blocked or downgraded
  by browsers. Low-cost fix: rewrite `http://www.kultunaut.dk` →
  `https://…` at parse time.
- Runtime rendering of "0t 0m" for the 55 movies without runtime is
  cosmetically malformed output.

## 8. Cleanup of old showtimes — FAIL

The importer has **no delete/prune step** for showtimes, movies or cinemas
that are no longer in the feed (the only `delete()` in `import.server.ts`
removes merged duplicate movie rows).

Evidence after the run:

- 2 942 showtimes still dated 2026-06-15 … 2026-06-18 (two months old).
- 84 movies with no future showtime at all.
- 6 cinemas with no future showtime.
- `showtimes.date` is stored as **text**, not `date`, so any cleanup or
  range query needs an explicit cast (`date::date`) — also a performance
  and correctness hazard.

## 9. Homepage — PASS (data) / WARNING (stale titles)

Homepage renders live imported data: posters resolve to
`kultunaut.dk/images/film/…`, counters read "211 FILM / 159 BIOGRAFER",
no console errors, no demo records anywhere (`demo-%` external ids: 0).
However the "211 FILM" list includes the 84 stale movies with no upcoming
screenings — a direct consequence of item 8.

## 10. Automated daily import — FAIL (two independent blockers)

1. **`KULTUNAUT_FEED_URL` secret is set to the literal string `kalorius`**
   (8 chars, not a URL). Every scheduled run since June has failed with
   `Feed fetch failed after 3 attempts: Invalid URL: kalorius`. Latest
   cron runs 2026-08-10 and 2026-08-12 both `failed`. The correct default
   is already in code — the bad secret overrides it.
2. **A stuck job blocks the concurrency guard.** `import_jobs` contains one
   row `running` since 2026-08-11 (phase `showtimes`, 400/…) and two
   `queued` rows from June. The scheduler skips any run while a job is
   `queued`/`running`, so even with a valid feed URL the daily import would
   be skipped indefinitely.

---

## Recommended fixes, in priority order

1. **Fix the `KULTUNAUT_FEED_URL` secret** — set it to
   `https://www.kultunaut.dk/perl/export/kalorius.xml` or delete it so the
   in-code default applies. (Blocks all automation.)
2. **Clear the stuck/queued import jobs** and add an automatic
   stale-job timeout (e.g. mark `running` jobs older than 1 h as `failed`)
   so one bad run can't permanently block the scheduler.
3. **Add a cleanup phase to the importer**: delete showtimes older than
   today, and delete showtimes/movies/cinemas absent from the current feed
   (or mark them inactive). Restores an accurate "aktuelle film" list.
4. **Change `showtimes.date` from `text` to `date`** and index
   `(date, cinema_id)` / `(date, movie_id)`.
5. **Force `https://` on poster URLs** at parse time.
6. **Handle missing runtime/year gracefully in the UI** (omit instead of
   rendering "0t 0m").
7. Optional: `formats` is empty on all 6 459 rows and `events` on all but 2
   — the 2D/3D/IMAX filter currently has nothing to match. Verify whether
   the feed carries this information at all before keeping the filter.
