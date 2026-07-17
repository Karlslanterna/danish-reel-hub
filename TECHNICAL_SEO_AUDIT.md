# Technical SEO Audit — Lanterna

Scope: technical SEO only. Ignores content quality, marketing copy, keyword strategy, and link-building.

Codebase reviewed:
- `src/routes/__root.tsx`, `index.tsx`, `film.$slug.tsx`, `biograf.$slug.tsx`, `by.$city.tsx`
- `src/routes/auth.tsx`, `_authenticated/*`
- `src/components/Poster.tsx`, `MovieCard.tsx`, `SiteHeader.tsx`
- `public/` (robots.txt, sitemap.xml, favicons, manifest)
- `src/server.ts`, `src/router.tsx`

Effort key: **XS** ≤15 min · **S** ~1 h · **M** ~half day · **L** ~1+ day.

---

## Critical

### C1. No `robots.txt`
- **Finding:** `public/robots.txt` does not exist. Crawlers get a 404 and fall back to default behavior; no `Sitemap:` directive is discoverable.
- **Why it matters:** Missing robots.txt removes an explicit crawl contract. Combined with C2, Google has no efficient way to discover the ~120 movie and ~160 cinema pages beyond following links from `/`. Also leaves admin/auth/mcp/api routes indexable in principle.
- **Recommended fix:** Add `public/robots.txt` with `User-agent: *`, `Allow: /`, `Disallow:` for `/admin`, `/auth`, `/api/`, `/.mcp`, `/.well-known`, `/.lovable`, and a `Sitemap: https://danish-reel-hub.lovable.app/sitemap.xml` line.
- **Effort:** XS

### C2. No `sitemap.xml`
- **Finding:** No `public/sitemap.xml` and no `src/routes/sitemap[.]xml.ts` server route. The site ships ~280 detail routes (`/film/$slug`, `/biograf/$slug`, `/by/$city`) but none are enumerated.
- **Why it matters:** Without a sitemap, discovery of movie/cinema/city pages depends entirely on internal links from the homepage. Many detail pages will be crawled slowly or missed, and there is no `lastmod` signal for the daily-changing showtime data.
- **Recommended fix:** Add a dynamic server route at `src/routes/sitemap[.]xml.ts` that emits `<url>` entries for `/`, every movie slug, every cinema slug, and each unique city derived from `fetchCinemas()`. Set `changefreq=daily` for movie/cinema pages, `weekly` for cities, `1.0` for `/`. Use the canonical host `https://danish-reel-hub.lovable.app`.
- **Effort:** S

### C3. No canonical URLs on any route
- **Finding:** Neither `__root.tsx` nor any leaf route emits `<link rel="canonical">`. The site is reachable on at least two hosts (`danish-reel-hub.lovable.app`, `id-preview--…lovable.app`) and users can arrive with tracking query strings.
- **Why it matters:** Google will pick a canonical for you, and the preview subdomain can be selected — leaking preview URLs into the index and splitting authority. Query variants (e.g. from filter state persisted to URL) can also fragment ranking signals.
- **Recommended fix:** Add `links: [{ rel: "canonical", href: "https://danish-reel-hub.lovable.app<path>" }]` in the `head()` of each leaf route (`index`, `film.$slug`, `biograf.$slug`, `by.$city`, `auth`). Do NOT add canonical in `__root.tsx` (TanStack concatenates `links`, producing duplicates). Build the URL from `params` and, for the home page, a static string.
- **Effort:** S

### C4. Preview host is indexable and appears in `og:image`
- **Finding:** `__root.tsx` sets `og:image` to a `pub-….r2.dev/…id-preview-…lovable.app-….png` asset, and there is no `robots` meta or host-level canonical steering Google away from `id-preview--…lovable.app`.
- **Why it matters:** Preview hosts can be indexed as duplicates of production; the OG image URL literally advertises the preview host to any crawler that scrapes share metadata. Duplicate-host indexing dilutes rankings.
- **Recommended fix:** (a) Regenerate or re-host the OG image on the production domain (or a neutral CDN path). (b) In `src/server.ts`, detect requests whose `Host` matches `id-preview--*.lovable.app` and either 301 to the production host or inject `X-Robots-Tag: noindex, nofollow`. (c) Ensure canonical (C3) always points at the production host.
- **Effort:** M

---

## High

### H1. Root `og:image` overrides every leaf page's share image
- **Finding:** `__root.tsx` defines `og:image` and `twitter:image`. Per project rules, root-level `og:image` concatenates into every match and overrides leaf images. `film.$slug` and `biograf.$slug` do not set their own `og:image`, so every movie/cinema share preview shows the generic homepage screenshot.
- **Why it matters:** Share previews are the same for every page — worse CTR from social/messaging and weaker entity signals to crawlers that use OG data.
- **Recommended fix:** Remove `og:image`/`twitter:image` from `__root.tsx`. Add them in `film.$slug` head() using `loaderData.movie.poster.url` (absolute URL required), and in `biograf.$slug` using a cinema hero image when available; omit on routes with no meaningful image (hosting injects a fallback screenshot).
- **Effort:** S

### H2. No structured data (JSON-LD) anywhere
- **Finding:** No `application/ld+json` scripts on any route. The site is a rich source of `Movie`, `MovieTheater`/`LocalBusiness`, and `ScreeningEvent` entities but publishes none of it.
- **Why it matters:** Movie and event schema unlock rich results (showtimes carousel, knowledge-panel eligibility, "Movies near me" surfaces). This is the single highest-leverage on-page SEO gap for a cinema portal.
- **Recommended fix:**
  - `__root.tsx`: `WebSite` + `Organization` with `SearchAction`.
  - `film.$slug`: `Movie` (name, director, genre, duration, contentRating, image, description) + array of `ScreeningEvent` (startDate, endDate, location=cinema, offers.url=ticket URL).
  - `biograf.$slug`: `MovieTheater` (name, address, geo, telephone, openingHours, url).
  - `by.$city`: `CollectionPage` + `BreadcrumbList`.
- **Effort:** M

### H3. Meta descriptions are truncated blindly to 155 chars
- **Finding:** `film.$slug` uses `movie.synopsis.slice(0, 155)`, `biograf.$slug` uses `cinema.description.slice(0, 155)`. No word-boundary handling, no fallback when the field is empty.
- **Why it matters:** Descriptions frequently end mid-word (poor SERP snippet). Empty descriptions produce empty `content=""` tags rather than a sensible default.
- **Recommended fix:** Trim on last space before 160, append `…`, and fall back to a templated string when empty (e.g. `Se spilletider og køb billetter til ${title} i Danmark.`).
- **Effort:** XS

### H4. No breadcrumbs (visible or in schema)
- **Finding:** Leaf routes only render a `← Tilbage` / `← Forside` link. There is no `<nav aria-label="breadcrumb">`, no visible trail, and no `BreadcrumbList` JSON-LD.
- **Why it matters:** Breadcrumbs improve site-structure signals and appear in Google SERPs in place of raw URLs; their absence on a 3-level site (home → city → cinema, home → movie) is a wasted SEO surface.
- **Recommended fix:** Add a breadcrumb component (`Forside / By / Cinema` or `Forside / Film / Title`) rendered near the top of each leaf, and emit matching `BreadcrumbList` JSON-LD via `head().scripts`. Combine with H2.
- **Effort:** S

### H5. TanStack `<Link>` renders with `href` but no crawl-safe fallback for API/showtime deep links
- **Finding:** Ticket-purchase `<a target="_blank">` links lack `rel="nofollow sponsored"`. Homepage's `Se spilletider` uses `href="#showtimes"` — fine — but ticket outbound links (~5k on the site) will pass PageRank to third-party ticketing.
- **Why it matters:** Leaks link equity to external ticket vendors; also arguably violates Google's paid/affiliate link guidance if any of these are affiliate.
- **Recommended fix:** Change ticket link `rel` from `noopener noreferrer` to `noopener noreferrer nofollow` (add `sponsored` if any are affiliate).
- **Effort:** XS

### H6. No `hreflang` and language mismatch risk
- **Finding:** `<html lang="da">` is set (good), but there is no `hreflang="da-DK"` or `x-default` self-reference. Site is Danish-only today, so this is low-impact — but the auth page still has Danish text yet no hreflang.
- **Why it matters:** Low priority while single-language; becomes High the moment an English or Swedish variant is added. Also, `hreflang` self-reference is a modest signal even for single-locale sites.
- **Recommended fix:** Add `<link rel="alternate" hreflang="da-DK" href="…"/>` and `hreflang="x-default"` on each leaf route. Defer full multi-locale until an EN version exists.
- **Effort:** S (now) / M (multi-locale later)

---

## Medium

### M1. Admin/auth/API routes are indexable
- **Finding:** `/auth`, `/admin/import`, `/admin/import/$jobId`, `/mcp`, `/api/public/*`, `/.mcp/*`, `/.well-known/*`, `/.lovable/oauth/consent` have no `robots` meta and no `X-Robots-Tag`. Some are gated by auth (return redirects) but the redirect target itself (`/auth`) is public and indexable.
- **Why it matters:** Thin/duplicate pages in the index dilute site quality signals; `/auth` in particular is a low-value page that can outrank real content for brand searches.
- **Recommended fix:** Add `{ name: "robots", content: "noindex, follow" }` in `head()` for `auth.tsx`, `_authenticated/*`, and any admin route. For API/MCP routes, return `X-Robots-Tag: noindex` from the server handler. Also disallow in robots.txt (see C1).
- **Effort:** S

### M2. Title template not enforced; some titles inconsistent
- **Finding:** Titles are hand-built per route (`"${title} — Lanterna"`, `"Film i ${city} — Lanterna"`). Root title is `"Lanterna — Danmarks…"`. There is no shared helper, so a new route can easily forget the suffix or exceed length. Movie titles like long documentaries can push past 60 chars once the suffix is added.
- **Why it matters:** Google truncates titles around 55–60 chars; inconsistency across routes hurts brand-in-SERP recognition and title CTR.
- **Recommended fix:** Add a `buildTitle(pageTitle, { max=60 })` helper in `src/lib/seo.ts` that appends ` — Lanterna` only if it fits, otherwise emits `pageTitle` alone. Use it in every leaf head().
- **Effort:** S

### M3. Missing `og:url`, `og:site_name`, `og:locale`
- **Finding:** `__root.tsx` sets `og:title/description/type/image` but no `og:url`, `og:site_name`, or `og:locale=da_DK`. Leaf routes don't set `og:url` either.
- **Why it matters:** `og:url` is what most scrapers (Slack, iMessage, Facebook, LinkedIn) treat as the canonical share target; without it they use the request URL, including any tracking params or the preview host (see C4).
- **Recommended fix:** Add `og:site_name=Lanterna` and `og:locale=da_DK` in `__root.tsx`. Add per-route `og:url` in each leaf head() (safe — meta dedupes by property).
- **Effort:** XS

### M4. Cinema and movie pages have no `<img>` on the OG-visible hero
- **Finding:** `film.$slug` uses the poster as a background image and a decorative blurred `<img alt="">`. The main visible image is decorative; the real content image (poster) is inside the `<Poster>` component which sets `alt={movie.poster.alt ?? movie.title}` — good — but on the film page, the visible poster is wrapped in `aria-hidden`-adjacent decorative treatment. Confirm the main `<Poster showTitle={false}>` still has descriptive alt (it does, via `movie.title`). Cinema pages have no cinema image at all.
- **Why it matters:** Image search visibility is directly tied to `alt` and surrounding text. Cinemas are entities users search for images of; the site currently offers none.
- **Recommended fix:** Keep current poster alt. For cinemas, add an image field (exterior photo or logo) and render it with descriptive alt like `"${cinema.name} i ${city}"`; wire the same URL into cinema `og:image` (see H1).
- **Effort:** M (needs data pipeline for cinema images)

### M5. No pagination / no `rel=prev|next` — but currently no need
- **Finding:** Homepage renders all ~120 movies at once; cinema page renders all films at that cinema. No pagination exists, so `rel=prev/next` isn't required (Google deprecated it anyway).
- **Why it matters:** As catalog grows, unbounded pages hurt CWV (LCP/CLS). No SEO harm today; flagging for scale.
- **Recommended fix:** When catalog crosses ~300 items on a single page, introduce filter-based URL segments (`/film/genre/drama`, `/film/aar/2026`) rather than pagination — each with its own canonical.
- **Effort:** L (deferred)

### M6. Core Web Vitals — poster images not sized
- **Finding:** `<Poster>` and `SiteHeader` logo use CSS aspect-ratio and `object-cover`, but `<img>` tags lack explicit `width`/`height` attributes (except the logo). Above-the-fold posters have `loading="lazy"` which delays LCP.
- **Why it matters:** Missing intrinsic dimensions cause CLS; `loading="lazy"` on the LCP image increases LCP time and hurts the Core Web Vitals ranking signal.
- **Recommended fix:** In `Poster.tsx`, add `width={400} height={600}` and accept a `priority` prop that sets `loading="eager"` + `fetchpriority="high"`. Pass `priority` on the first ~5 posters of `/` and on the film page's hero poster.
- **Effort:** S

### M7. Poster images have no `srcset`/`sizes` and are served at unknown resolution
- **Finding:** `<img src={posterUrl}>` is used at multiple render sizes (grid card, 180 px row, 340 px hero) with the same source URL. No `srcset` or responsive `sizes`.
- **Why it matters:** Wasted bytes → poor LCP on mobile → CWV penalty. Also affects image-search quality signals.
- **Recommended fix:** If poster URLs support width params, generate `srcset="… 200w, … 400w, … 800w"` with `sizes` matching each context. Otherwise, request an image-transform CDN.
- **Effort:** M

### M8. No `<link rel="preload">` for the LCP image or fonts
- **Finding:** Google Fonts stylesheet is `preconnect`ed (good) and loaded via `<link>` (correct — no `@import` in CSS). But no font `preload` and no LCP-image preload.
- **Why it matters:** Fonts block text render; the LCP image on the film page is the hero poster. Both are preload candidates.
- **Recommended fix:** Add `<link rel="preload" as="font" type="font/woff2" crossorigin>` for the primary Google Sans weight, and (per-route) preload the film page's hero poster from `head().links`.
- **Effort:** S

---

## Low

### L1. Trailing `— Lanterna` in every title duplicates brand across SERP
- **Finding:** Every title ends with `— Lanterna`. Google sometimes rewrites; still fine but visually repetitive when multiple pages appear on one SERP.
- **Why it matters:** Minor CTR loss.
- **Recommended fix:** Combine with M2 — helper only appends suffix when total ≤60.
- **Effort:** XS (part of M2)

### L2. `twitter:site="@Lovable"` is wrong owner
- **Finding:** `__root.tsx` sets `twitter:site` to `@Lovable`, the platform vendor, not the project.
- **Why it matters:** Twitter attribution goes to the wrong account.
- **Recommended fix:** Replace with the Lanterna Twitter/X handle, or drop the tag if none exists.
- **Effort:** XS

### L3. Filter state is client-only, invisible to crawlers
- **Finding:** Radius/date filters live in `FiltersProvider` + `localStorage`, not in the URL. Filter combinations aren't crawlable (and — correctly — don't create duplicate URLs).
- **Why it matters:** No SEO harm today. Becomes an opportunity if you later want `/film?dato=i-morgen` style landing pages.
- **Recommended fix:** No action. If later promoted to URL state, ensure only whitelisted combinations are canonical; others should `noindex`.
- **Effort:** — (deferred)

### L4. No HTTP status control from route loaders
- **Finding:** `notFound()` throws render a 404 UI, but the HTTP response status returned by `src/server.ts` is not verified. `/not-a-real-slug/film` should return `404`, not `200` with a 404 page.
- **Why it matters:** Google's crawl budget and index quality depend on correct status codes; soft-404s are penalized.
- **Recommended fix:** Verify with `curl -I https://danish-reel-hub.lovable.app/film/does-not-exist` — expect `404`. If it returns 200, wire `notFoundComponent` matches to set response status via TanStack Start's response helpers.
- **Effort:** S (verification) / M (fix if broken)

### L5. No redirects for legacy/alternate slugs
- **Finding:** Movie/cinema slugs come from `slugify(title)` — if a title changes upstream in Kultunaut, the URL changes with no redirect from the old slug.
- **Why it matters:** Any external link to the old slug 404s, killing backlink equity.
- **Recommended fix:** Persist `previous_slugs` on movies/cinemas and add a splat handler that 301s old slugs to current ones.
- **Effort:** M

### L6. Internal linking — cinemas link to cinema page but not to their city; movies don't link to cities they play in
- **Finding:** Cinema cards link only to `/biograf/$slug`. City pages exist (`/by/$city`) but are only reachable via search suggestions. Movie pages don't link to the cities where the movie is showing.
- **Why it matters:** City hub pages need internal PageRank to rank for `"biograf i ${city}"` queries. Currently they are near-orphaned.
- **Recommended fix:** (a) On cinema cards, show the city as a linked pill. (b) On film pages, group showtimes by city and link the city name to `/by/$city`. (c) Ensure sitemap (C2) lists all cities.
- **Effort:** S

### L7. Sitemap discovery via `Sitemap:` directive missing
- **Finding:** Even after C2, robots.txt (C1) must reference the sitemap; sitemap alone is not enough for some crawlers.
- **Why it matters:** Reduces sitemap discovery latency.
- **Recommended fix:** Bundled with C1.
- **Effort:** — (part of C1)

### L8. `<html lang="da">` set only on shell — good — but no `dir="ltr"`
- **Finding:** No `dir` attribute. Danish is LTR so the default is correct; flagging only for completeness.
- **Why it matters:** Negligible.
- **Recommended fix:** Optional — add `dir="ltr"` for explicitness.
- **Effort:** XS

---

## Summary

| Priority | Count | Themes |
|---|---|---|
| Critical | 4 | robots.txt, sitemap.xml, canonical, preview-host indexing |
| High | 6 | og:image leakage, JSON-LD, meta descriptions, breadcrumbs, hreflang, outbound rel |
| Medium | 8 | noindex admin, title helper, og:url, cinema images, CWV, srcset, preload |
| Low | 8 | copy/attribution, redirects, internal links, status codes |

Highest ROI order to tackle: **C1 → C2 → C3 → H2 → H1 → C4 → M6/M7 → M1 → H3/H4**.
