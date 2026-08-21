# Defensive canary for Nordisk Film screenings (analysis + recommendation)

Goal: detect whether biffen.info republishes Lanterna's Nordisk Film showtime data, without inventing any data and without touching the database.

## What the investigation showed

- All Nordisk Film cinemas in production are Kultunaut-sourced (`cinemas.source = 'kultunaut'`, no `ebillet_organizer_id`). Their ticket URLs are `http://www.kultunaut.dk/perl/billet/type-nynaut?ArrNr=<id>&start=<epoch>`.
- biffen.info does expose outbound booking URLs: on a film page the ticket button points to `https://bio-app.tintwotin.workers.dev/go?cinema=<id>&url=<url-encoded provider URL>&source=site`. So a URL-level marker is copyable and observable, provided their pipeline keeps the full URL string (their encoding preserves query params; a `#fragment` may or may not survive).
- biffen.info also renders raw cinema names ("Dagmar Teatret, NF Bio") and film titles, but those strings look provider-derived, not necessarily Lanterna-derived, so text watermarks are weaker evidence than a URL marker.
- The existing canary (`src/lib/outbound-ticket-attribution.ts`) is an allowlist of 8 `ArrNr` values. Those rows exist in `screenings` right now for Dobbeltspil at Dagmar Teatret (38 rows, 2026-08-22..29), but the live page earlier rendered a different `ArrNr` set for the same cinema: Kultunaut re-issues arrangement numbers on refresh. **An ArrNr allowlist is therefore not durable** and is the most likely reason the canary was not observable in production.

## Recommended selection rule (durable, no DB writes)

Scope by canonical cinema id, not by arrangement id:

- Cinema: `kn-21529` (Nordisk Film Biografer - Dagmar Teatret) — single venue, ~316 upcoming screenings, stable id across refreshes.
- Source: only URLs on host `kultunaut.dk` / `www.kultunaut.dk` with path `/perl/billet/type-nynaut` (leaves eBillet untouched).
- Additional narrowing: only screenings whose `local_date` is 2–9 days ahead (avoids today/tomorrow, the highest-traffic booking window) — computed at read time, so it drifts with the calendar and survives every import.

This needs no migration, no data edit, and is reversible by removing one module plus its two call sites.

## Recommended implementation (3 layers, one element)

All changes are at the public read/render boundary. Nothing in the importer, pipeline, snapshot, or promotion path changes.

1. **URL fragment (primary signal)**
   - `src/lib/outbound-ticket-attribution.ts`: replace the ArrNr allowlist with `addOutboundTicketAttribution(rawUrl, ctx: { cinemaId, localDate })` implementing the rule above; append `#lref-<token>` only (never touch origin, path, or query). A fragment is never sent to Kultunaut, so booking keeps working byte-identically.
   - `src/lib/screening-read-model.ts` (`normalizeTicketUrl`, `groupScreeningsForUi`): pass cinema id + date through; the row already carries both.
   - `src/lib/cinema-data.ts` (`mapMovieShowtimeGroups`, ~line 709): pass `canonicalCinemaId(row.cinema_id)` and `row.local_date` into normalization — this is the path the film page actually renders.
   - `src/lib/kultunaut/normalize.ts` currently also calls `normalizeTicketUrl`; keep it canary-free by making the context argument optional and omitting it there (import output must stay unmarked).

2. **Data attribute (same element)**
   - `src/components/MovieDetail.tsx` (~line 430): on the existing showtime `<a>`, add `data-lref={marker}` when the marker applies. No visual change, no accessibility change, no JSON-LD change.

3. **Invisible spacing watermark (scoped, optional third layer)**
   - Only inside the same showtime anchor's text node, and only for marked slots: render the time as `HH:MM` with the `:` separator followed by U+2060 (word joiner) — zero-width, no layout shift, copy/paste-safe. Do **not** apply to titles, slugs, JSON-LD (`src/lib/jsonld.ts`), `aria-label`s, or filter/search inputs; the time string is not used for matching anywhere.
   - If any risk of this appearing in a filter/sort key is found during implementation, drop layer 3 and keep layers 1 and 2.

Explicitly unchanged: film titles, cinema names, route slugs, dates, times, availability, prices, event labels, sitemaps, canonicals, JSON-LD, filter/search behaviour, and every DB record.

## Tests

- Rewrite `src/lib/outbound-ticket-attribution.test.ts`: marked only for cinema `kn-21529` + Kultunaut booking path + date inside the 2–9 day offset window; unchanged for other cinemas, other hosts, eBillet URLs, out-of-window dates, and missing context; origin/path/query byte-identical; fragment exactly the token.
- `src/lib/screening-read-model.ts` test: ticket URLs stay aligned with times after grouping/sorting when markers are added.
- `src/lib/jsonld.test.ts` assertion: JSON-LD offer URLs and names contain no marker and no U+2060.
- Playwright check in `tests/e2e/`: on `/biograf/nordisk-film-biografer-dagmar-teatret`, at least one marked ticket link exists, its `href` origin+path+query matches the unmarked provider URL, and `data-lref` is present.

## How to detect a hit

- Weekly (or after any biffen.info refresh), fetch one biffen.info film page for a film playing at Dagmar and search the raw HTML for the token — both plain (`#lref-...`) and URL-encoded (`%23lref-`), since their redirect worker encodes the provider URL.
- Secondary: search their markup for U+2060 in time labels, and for `data-lref`.
- Absence is not proof of no copying (a fragment can be stripped); presence of the token in their output is strong evidence, because the string exists nowhere in Kultunaut's own feed.
- Keep a dated note of when the canary went live so any later observation can be attributed.

## Risks

- Fragment stripping by their normaliser → mitigated by layers 2 and 3.
- False negative if they only copy titles/times from the provider directly.
- Analytics/click tracking is unaffected; outbound requests are identical.
- Zero-width character is the only layer with any user-visible risk (copy/paste of a time); it is scoped to one cinema's showtime pills and is the first layer to drop if unclear.

Nothing has been changed. Approve to implement.
