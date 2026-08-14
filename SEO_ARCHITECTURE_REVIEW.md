# LANTERNA — SEO Architecture Review (recommendations only)

Scope: organic Google traffic for movies, cinemas, cities, movie+city, movie+cinema.
Nothing in this document is implemented. It is a proposed roadmap for approval.

---

## 1. Current state

### Indexable routes today
| Route | Purpose | Indexable | Notes |
|---|---|---|---|
| `/` | Homepage, filtered movie grid | Yes | All discovery happens through client-side filters |
| `/film/$slug` | National movie page | Yes | Canonical self |
| `/biograf/$slug` | Cinema page | Yes | Canonical self |
| `/$city` | City landing | Yes | Canonical self |
| `/$city/film/$slug` | Movie in city | Yes, but canonicalised away to `/film/$slug` | Currently generates crawlable but non-indexable duplicates |
| `/by/$city` | Legacy | 301 → `/$city` | Correct |
| `/auth`, `/reset-password`, `/admin/*`, `/api/*`, `/.mcp/*` | Internal | noindex + robots disallow | Correct |

### Findings
1. **The largest ranking surface is deliberately suppressed.** `/$city/film/$slug` canonicalises to `/film/$slug`. "Weapons København" / "film i Aarhus i dag" style queries are exactly where commercial intent lives, and today those pages hand all their equity to the national page.
2. **No movie+cinema pages at all.** `/biograf/$slug` lists movies, but there is no `/biograf/$slug/film/$slug`. Queries like "Weapons Nordisk Film Palads" have no landing page.
3. **No city→cinema hub structure.** Cinemas are flat at `/biograf/$slug` with no `/koebenhavn/biografer` index; the only path in is the city page listing.
4. **Crawl depth is fine but link graph is thin.** Header only links `/`. Cinema pages link movies nationally (`/film/$slug`) rather than to the city-scoped equivalent. No cross-links between sibling cinemas, nearby cities, or same-genre movies.
5. **Sitemap is incomplete relative to the route set.** It emits `/`, `/film/*`, `/biograf/*`, `/{city}` — no city×movie URLs, no `lastmod` derived from showtime data (uses `created_at`, and the homepage entry uses generation date, which is a non-page-specific fallback and should be dropped).
6. **Breadcrumbs exist visually and in JSON-LD** on movie/cinema/city, but the movie page breadcrumb has no city level even when reached from a city.
7. **Structured data is good** (Movie, ScreeningEvent, MovieTheater, BreadcrumbList, WebSite, Organization). Gaps: no `ItemList` on city/cinema listings, `ScreeningEvent` lacks `endDate`/`eventStatus`/`inLanguage`/`videoFormat` (we now have tags), no `openingHours`/`telephone` on MovieTheater.
8. **Thin content risk is real** — showtimes are a 30-day window; a city with 1 cinema and 3 movies, or a movie with zero upcoming screenings, produces near-empty pages that Google will classify as thin/soft-404.
9. **No pagination anywhere** — currently fine (catalogue ~130 movies, ~160 cinemas) but city pages render everything client-filtered, so crawlers see one big list; acceptable at current scale.
10. **Duplicate content risk** — filters are client state, not URL state, so no parameter bloat. Good. The risk is instead the opposite: valuable filter states (date, genre) are invisible to Google.

---

## 2. Proposed architecture

### 2.1 URL structure (target)
```
/                                   Home — national "film i biografen i dag"
/film                               All movies index (new)
/film/{movie}                       National movie page
/biografer                          All cinemas index (new)
/biograf/{cinema}                   Cinema page
/biograf/{cinema}/film/{movie}      Movie at cinema (new)
/{city}                             City hub — movies + cinemas in city
/{city}/film/{movie}                Movie in city (promote to indexable)
/{city}/biografer                   Cinemas in city (new)
/genre/{genre}                      Genre index, national (new, low priority)
/{city}/genre/{genre}               Genre in city (only if volume justifies)
```
Keep Danish, lowercase, ASCII slugs (`/koebenhavn`) — already correct. Keep bare city at root level; it is short and matches how Danes search.

### 2.2 Canonical strategy
Principle: **canonical self whenever the page has unique, substantial content; canonical up only when it does not.**

| Page | Canonical | Condition |
|---|---|---|
| `/film/{m}` | self | always |
| `/{city}/film/{m}` | **self** | when ≥1 upcoming showtime in that city |
| `/{city}/film/{m}` | `/film/{m}` + `noindex` | when 0 showtimes in window |
| `/biograf/{c}/film/{m}` | **self** | when ≥1 upcoming showtime at that cinema |
| `/biograf/{c}/film/{m}` | `/{city}/film/{m}` + `noindex` | otherwise |
| `/{city}` | self | when city has ≥1 cinema with showtimes |
| `/biograf/{c}` | self | always (evergreen venue entity) |

Uniqueness must be earned, not asserted: each city/cinema variant needs its own H1, intro sentence naming the city/venue, the actual showtime table, address/transport info, and a differentiated title+meta. Without that, keep the current consolidating canonical.

### 2.3 Internal linking
- Header: add persistent links to `/film`, `/biografer`, and the user's active city hub.
- Footer (new, sitewide): top 15–20 cities, top 10 cinemas, "Film i biografen i dag". This is the single cheapest crawl-depth fix — puts every hub within 1 click.
- City page: link each movie to `/{city}/film/{m}` (already does), each cinema to `/biograf/{c}`, plus a "Nærliggende byer" block.
- Cinema page: link movies to `/biograf/{c}/film/{m}` (currently `/film/{m}`), plus "Andre biografer i {by}".
- Movie page: "Se {title} i" city list linking `/{city}/film/{m}` — this is the main injection point for the city×movie layer.
- Movie page: "Lignende film" (same genre, ranked by upcoming screenings).
- Every deeper page links back up (breadcrumb) so PageRank recirculates.

Target crawl depth: every indexable URL ≤3 clicks from `/`.

### 2.4 Breadcrumbs
Visual + `BreadcrumbList` on all levels, matching URL nesting:
```
Forside / København / Weapons
Forside / København / Nordisk Film Palads / Weapons
Forside / Film / Weapons
```
Fix: city-scoped movie pages currently emit the national 2-level crumb.

### 2.5 Sitemap strategy
Split into a sitemap index:
```
/sitemap.xml            → index
/sitemap-core.xml       → /, /film, /biografer, city hubs
/sitemap-movies.xml     → /film/{m}
/sitemap-cinemas.xml    → /biograf/{c}
/sitemap-city-movies.xml→ /{city}/film/{m}   (only combos with showtimes)
/sitemap-cinema-movies.xml → /biograf/{c}/film/{m} (only combos with showtimes)
```
Rules: only emit URLs that pass the indexability condition in 2.2; drop the generated-at-build `lastmod` on `/`; derive `lastmod` from the newest relevant showtime `updated_at`, else omit. Cap 50k URLs/file.

### 2.6 Structured data additions
- `ItemList` on `/film`, `/biografer`, `/{city}`, `/biograf/{c}` movie listings.
- `ScreeningEvent`: add `endDate` (start+runtime), `eventStatus`, `eventAttendanceMode`, `inLanguage`, `videoFormat` (from existing 2D/3D/IMAX tags), `offers.availability` and `priceCurrency: DKK`.
- `MovieTheater`: `telephone`, `sameAs` (official site), `openingHoursSpecification` if available.
- `Movie`: `aggregateRating` only if we ever hold first-party ratings — do not import TMDb ratings as our own.
- Keep `WebSite` + `Organization` at root only.

### 2.7 Thin & duplicate content guards
- Minimum-content gate: a city/cinema×movie page needs ≥1 upcoming showtime, otherwise `noindex,follow` + canonical up (never a 404 — the URL should still render "ingen visninger lige nu" with links onward).
- Zero-showtime movies: keep `/film/{m}` indexable (evergreen film entity with TMDb synopsis) but drop from showtime-based sitemaps.
- Never generate a page per date, per format, or per language — those stay client-side filters, unindexed.
- Enforce unique title/meta templates per layer; audit for template collisions before shipping each layer.

### 2.8 Pagination
Not needed at current scale. When any listing exceeds ~100 items, use `?side=2` with self-canonicals per page and crawlable `<a>` links — not infinite scroll only.

---

## 3. Ranked recommendations

Impact 1–5 (5 = highest organic upside). Effort S/M/L.

### P0 — do first
| # | Recommendation | Impact | Effort |
|---|---|---|---|
| 1 | Make `/{city}/film/{m}` self-canonical + genuinely unique content (city H1, city intro, city showtimes, unique meta), gated on ≥1 showtime | 5 | M |
| 2 | Sitewide footer with city + cinema hub links (crawl depth fix) | 4 | S |
| 3 | Add city×movie URLs to the sitemap (split into sitemap index) | 4 | S |
| 4 | Thin-content gate: `noindex,follow` for zero-showtime combos, everywhere | 4 | S |
| 5 | Remove build-time `lastmod` on `/`; derive `lastmod` from showtime data or omit | 3 | S |

### P1 — next
| # | Recommendation | Impact | Effort |
|---|---|---|---|
| 6 | New `/biograf/{c}/film/{m}` layer, self-canonical when it has showtimes | 5 | L |
| 7 | Cinema page links movies to the cinema-scoped page instead of national | 4 | S |
| 8 | Movie page "Se filmen i" city list (injects the whole city×movie layer) | 4 | S |
| 9 | `/film` and `/biografer` national indexes with `ItemList` | 3 | M |
| 10 | Fix breadcrumbs to match URL nesting on city/cinema-scoped pages | 3 | S |
| 11 | `/{city}/biografer` sub-hub | 3 | M |

### P2 — later
| # | Recommendation | Impact | Effort |
|---|---|---|---|
| 12 | ScreeningEvent enrichment (endDate, inLanguage, videoFormat, offers) | 3 | S |
| 13 | "Lignende film" and "Andre biografer i {by}" related blocks | 3 | M |
| 14 | MovieTheater enrichment (telephone, openingHours, sameAs) | 2 | S |
| 15 | Genre hubs `/genre/{g}` (and city genre only if data supports) | 2 | M |
| 16 | Pagination framework for listings >100 items | 1 | M |
| 17 | Nearby-cities module on city hubs | 2 | M |

### Explicitly not recommended
- Date-, format-, or language-specific URLs (`/koebenhavn/film/x/i-morgen`) — duplicate farm.
- FAQPage markup as an SEO tactic.
- Importing TMDb ratings as `aggregateRating`.
- Indexing filter permutations of the homepage.

---

## 4. Expected indexable page count
| Layer | Approx. URLs |
|---|---|
| Core (home, indexes) | ~4 |
| Movies | ~130 |
| Cinemas | ~160 |
| City hubs | ~70–90 |
| City × movie (gated) | ~1,500–3,000 |
| Cinema × movie (gated) | ~2,000–3,500 |
| **Total** | **~4,000–7,000 quality pages** vs ~360 today |

All of it churns with the 30-day showtime window, which is why the gating rules and sitemap `lastmod` discipline in P0 matter more than raw page count.

---

## 5. Suggested sequencing
1. P0 items 1–5 as one release (unlocks the city layer, ~10× indexable pages).
2. Measure 3–4 weeks in Search Console: indexed count, impressions on "{film} {by}" queries.
3. Only then build P1 item 6 (cinema×movie), the biggest but riskiest layer for thin content.
4. P2 as polish.
