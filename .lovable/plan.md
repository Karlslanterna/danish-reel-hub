# TMDb Integration — Technical Design (for review)

Kultunaut stays authoritative for cinemas, showtimes and ticket links. TMDb becomes authoritative for film metadata (title art, synopsis, runtime, genres, cast/crew, ratings). The design keeps room for IMDb and Letterboxd as additional providers later.

## 1. Data model

Keep `movies` as the Kultunaut-owned identity row, and move enrichment into provider-agnostic tables.

**`movies` (existing, trimmed responsibility)**
Keeps: `id`, `slug`, `external_id` (Kultunaut), `title` (feed title), `original_title`, `release_date`/`year` as reported by the feed. Existing metadata columns (`runtime`, `genre`, `synopsis`, `poster`, `director`, `rating`, `trailer_url`) stay in place as the fallback layer — no destructive change.

**`movie_metadata` (new)** — one row per movie per provider.
- `movie_id` -> `movies.id`
- `provider` (`tmdb` | `imdb` | `letterboxd`)
- `provider_id` (TMDb movie id, IMDb tt-id, Letterboxd slug)
- `title`, `original_title`, `synopsis`, `runtime`, `release_date`, `genres[]`, `poster_url`, `backdrop_url`, `trailer_url`, `directors[]`, `cast` (jsonb), `certification`, `vote_average`, `vote_count`, `original_language`, `homepage`
- `raw` jsonb (the trimmed provider payload, for reprocessing without re-fetching)
- `fetched_at`, `stale_after`, `etag`, `created_at`, `updated_at`
- unique `(movie_id, provider)`; index on `(provider, provider_id)`

**`movie_provider_links` (new)** — the match record, kept separate from the payload so matching can be re-run and audited.
- `movie_id`, `provider`, `provider_id`
- `confidence` numeric 0–1, `match_method` (`exact_title_year`, `normalized_title`, `original_title`, `fuzzy`, `imdb_crosswalk`, `manual`)
- `status`: `confirmed` | `candidate` | `ambiguous` | `rejected` | `unmatched`
- `candidates` jsonb (top N scored alternatives, for the admin review UI)
- `reviewed_by`, `reviewed_at`, timestamps
- unique `(movie_id, provider)`; partial unique on `(provider, provider_id)` where `status='confirmed'` to prevent two Kultunaut films binding the same TMDb id silently

**`provider_fetch_log` (new, optional but recommended)** — per-call record of provider, endpoint, status, duration, error, for quota tracking and debugging.

**Read path**: a `movies_view` (or a resolver in `src/lib/cinema-data.ts`) that coalesces per field: confirmed TMDb value -> Kultunaut value -> null. Field-level coalesce, not row-level, so a TMDb row missing a runtime still falls back.

RLS: public read on `movie_metadata` (it feeds public pages), admin-only read on `movie_provider_links` and `provider_fetch_log`; all writes service-role only.

## 2. Matching strategy

Normalization before comparison: lowercase, strip diacritics, strip trailing bracketed years, strip trailing edition/format noise (`3D`, `OV`, `m/ dansk tale`, `Babybio`), collapse punctuation/whitespace. Reuse the existing `slugify` + `showtime-tags` normalizers.

Candidate lookup order per Kultunaut film:
1. `search/movie` with normalized title + `year` from the feed (`primary_release_year`).
2. If empty, same search without the year.
3. If empty and an original title exists, search that.

Scoring (0–1) over each candidate:
- title similarity (normalized Levenshtein/trigram) — weight 0.5, evaluated against both `title` and `original_title`, best wins
- release year delta: exact 1.0, ±1 year 0.7, ±2 0.3, else 0 — weight 0.3
- runtime delta when the feed provides one: within 5 min 1.0, within 15 min 0.5 — weight 0.1
- popularity/vote_count tiebreaker — weight 0.1

Decision thresholds:
- score >= 0.90 and the gap to the runner-up >= 0.15 -> `confirmed`, auto-enrich
- 0.70–0.90, or a tight gap to the runner-up -> `ambiguous`, store top 5 candidates, no enrichment, surfaced in an admin review queue
- < 0.70 or no results -> `unmatched`, retried on a later run (feeds get corrected over time)

Manual override in the admin UI sets `status='manual'/'confirmed'` with `confidence=1`; a manual link is never overwritten by an automatic run. Rejections are remembered so the same wrong candidate is not re-proposed.

IMDb/Letterboxd later: TMDb's `external_ids` gives the IMDb tt-id for free, so IMDb becomes a crosswalk rather than a fresh matching problem, and Letterboxd is derivable from the TMDb/IMDb id. Same tables, new `provider` value.

## 3. Import and enrichment pipeline

Enrichment is a separate phase in the existing background job, not a blocking part of the Kultunaut import — the site must stay correct if TMDb is down.

Existing phases: `movies` -> `cinemas` -> `showtimes` -> `cleanup`.
New phase inserted after `cleanup`: `enrich`.

The `enrich` phase, batched exactly like the other phases (cursor-based, resumable, one batch per `/process` call):
1. Select the work list: movies with no `movie_provider_links` row for `tmdb`, plus movies whose confirmed metadata is past `stale_after`, plus previously `unmatched` movies older than N days. Ordered by "has upcoming showtimes" first, so visible films get enriched first.
2. Per movie: match (section 2) -> if confirmed, fetch `movie/{id}?append_to_response=credits,videos,images,release_dates,external_ids` (one call) -> upsert `movie_metadata` + `movie_provider_links`.
3. Record counts on the job (`processed_enriched`, `matched`, `ambiguous`, `unmatched`) so the pipeline page shows them.
4. Errors on a single film never fail the job; they are appended to `errors[]` and the film retried next run.

Cleanup interaction: when a movie row is deleted for having no upcoming showtimes, its metadata cascades. Consider retaining `movie_provider_links` keyed by Kultunaut `external_id` (rather than the internal id) so a film returning to cinemas does not need re-matching or re-fetching.

## 4. Refresh and caching

- Confirmed metadata TTL is tiered: films with upcoming showtimes refresh every 7 days; films released within the last 60 days every 3 days (posters/trailers/certifications land late); everything else every 30 days.
- `stale_after` is stored per row, so refresh selection is a single indexed query, not a full scan.
- `raw` payload retained so display changes (new field, different image size) are re-derivable without any API call.
- Poster/backdrop URLs are stored as TMDb CDN paths plus a size, resolved to full HTTPS URLs at render time — image size choices then change without a re-fetch. The existing `toHttpsUrl` guard stays.
- Page-level caching is unchanged; the read layer serves from our DB only, never from TMDb at request time.

## 5. API usage minimization

- One `search` call plus one `append_to_response` detail call per newly matched film — never separate credits/videos/images calls.
- Configuration endpoints (image base URL, genre list) fetched once per week and cached in a small `provider_config` cache row.
- Per-run cap (e.g. 500 films) with resumption on the next run, keeping any single job well within TMDb rate limits.
- Conditional refresh: skip the write and just bump `stale_after` when the payload is unchanged.
- Client-side token bucket (~40 requests / 10s, configurable) plus `provider_fetch_log` for quota visibility.
- The TMDb read token lives in project secrets and is only ever read inside server handlers.

## 6. Error handling and retries

- 429: honour `Retry-After`, exponential backoff, and end the batch early rather than burning the job's time budget; the job stays resumable.
- 5xx / network: up to 3 retries with jittered backoff, then defer the film to the next run.
- 401/403: treated like the existing Kultunaut `FeedAccessError` — the job records a clear Danish message ("TMDb afviste adgang (HTTP 401)") on the pipeline page, never echoing the token.
- 404 on a previously confirmed id: mark the link `rejected` and requeue for re-matching.
- Per-film failure counter; after 5 consecutive failures the film is parked and reported in the admin review queue instead of retried forever.
- Health: extend the existing `import-health` endpoint with an enrichment section (match rate, ambiguous count, last successful enrichment) — degraded enrichment must not turn overall status critical, since the site still works.

## 7. Field ownership

| Field | Owner | Notes |
|---|---|---|
| cinema identity, address, geo, website | Kultunaut | unchanged |
| showtimes, dates, halls, formats/languages/events tags | Kultunaut | unchanged |
| ticket URLs / booking links | Kultunaut | never from TMDb |
| film identity in our DB (`id`, `slug`, `external_id`) | Kultunaut | slug stays stable for SEO |
| feed title / original title | Kultunaut (matching input) | display title prefers TMDb |
| synopsis, runtime, genres, release date, poster, backdrop, trailer, cast, director, ratings, original language, certification | TMDb | Kultunaut value is the fallback |
| Danish-language synopsis | TMDb `language=da-DK` first, Kultunaut fallback | Kultunaut often has better Danish copy — worth a per-field preference flag |
| aggregate ratings / user reviews | IMDb / Letterboxd later | additive only |

## 8. Migration strategy

1. Migration A — additive only: create `movie_metadata`, `movie_provider_links`, `provider_fetch_log` with grants, RLS, and updated_at triggers. Nothing on the existing tables changes; the site is unaffected.
2. Backfill run: enrichment phase executed manually from the admin pipeline page over the current ~127 films. Review the ambiguous queue.
3. Read-layer switch: `cinema-data.ts` starts coalescing TMDb over Kultunaut, behind a flag so it can be reverted instantly.
4. Observation window: compare film pages before/after; verify no film loses a poster or synopsis (the coalesce guarantees this, but verify).
5. Migration B — later, optional: once TMDb coverage is proven, deprecate the metadata columns on `movies` rather than dropping them; drop only after a full release cycle.

No destructive step happens before coverage is measured.

## 9. Risks and recommendations

- **Danish market coverage.** Local/arthouse Danish titles and one-off events (Babybio screenings, opera transmissions, festival films) are frequently absent from TMDb. Expect a real unmatched tail; the Kultunaut fallback and a manual-link UI are mandatory, not optional.
- **Wrong-match damage.** A confident wrong match shows the wrong poster and synopsis on a public page. Mitigation: conservative thresholds, runner-up gap requirement, and the ambiguous queue defaulting to no enrichment.
- **Title noise.** Kultunaut titles carry format and event suffixes; matching quality depends heavily on the normalizer. Recommend unit tests over a fixture set of real feed titles before rollout.
- **TMDb attribution and terms.** TMDb requires attribution ("This product uses the TMDb API but is not endorsed or certified by TMDb") — plan a footer/about-page line.
- **Duplicate collapse interaction.** The importer already merges same-title films; run TMDb matching *after* that merge so we do not enrich rows that are about to disappear.
- **Rate limits during backfill.** Cap the first run and let it span several scheduled runs rather than doing 127+ films in one burst.
- **Recommendation on sequencing:** ship schema + matching + admin review queue first with enrichment write-only (not displayed), verify match quality against real data, and only then flip the read layer.

## Open questions for you

1. Danish synopsis preference: TMDb `da-DK` when present, or always prefer the Kultunaut Danish text?
2. Should posters switch to TMDb art wherever available, or keep Kultunaut art when it exists (branding consistency with the physical campaign)?
3. Do you want the admin review queue in this phase, or auto-only matching first?
