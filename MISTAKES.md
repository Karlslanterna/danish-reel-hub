# Mistakes and prevention rules

This is a concise operational log. Each entry records the failure, cause, permanent rule, and release test.

## M-001 — Declared the combined work complete without a new admin area

- What happened: Tasks 1–4 were reported as complete even though the agreed admin rebuild did not exist and analytics was still placeholders.
- Why: The acceptance scope was silently narrowed to the pieces that had been implemented.
- Rule: Keep the original acceptance list visible and report each deliverable separately as implemented, tested, deployed, and production-verified.
- Test: The release checklist links every original deliverable to a real route, query, or test result; no placeholder counts as complete.

## M-002 — Exposed special filters before an official-source audit

- What happened: Babybio appeared as a filter while official Empire Babybio screenings were missing, and programme tags included false or expired titles.
- Why: Code-level tag extraction was treated as proof of data quality.
- Rule: Validate raw source, normalizer, production row, and live UI for positive and negative examples before release.
- Test: Empire's official Babybio programme and the current Filmporten/Biografklub lists are checked against production samples.

## M-003 — Parser fix without production refresh

- What happened: eBillet's object-valued screening type was handled in code, but existing production rows were imported before the fix and stayed unlabelled.
- Why: Deployment and data backfill were treated as the same operation.
- Rule: Every normalization change includes a targeted/full re-import and a post-import query.
- Test: The release evidence includes a production row created by the new normalizer.

## M-004 — Route filter did not update shared filter state

- What happened: `/babybio` filtered its own page but cleared the shared event value, so the selection disappeared on film/cinema navigation.
- Why: Route state and interactive filter state had separate ownership.
- Rule: A route activates the same persisted state used by every listing.
- Test: Automated navigation test confirms the active filter and results survive listing → film → cinema.

## M-005 — Cinema filter support was claimed from component presence

- What happened: A generic filter component existed on cinema pages, but time/child predicates and correct production tags were absent.
- Why: Rendering a control was confused with end-to-end behaviour.
- Rule: A filter is supported only when the page applies its predicate to canonical rows and production smoke testing verifies a result.
- Test: A shared filter conformance suite runs against home, city, cinema, and film programmes.

## M-006 — Queried the wrong database project

- What happened: A connected Supabase project with legacy tables was initially mistaken for Lanterna's actual Lovable production database.
- Why: Project identity was inferred from its display name.
- Rule: Access Lanterna's Supabase project only through Lovable's Supabase connection. Never substitute a separately connected project based on its display name.
- Test: Release notes confirm the database was reached through Lovable and verify that the canonical `screenings` read model exists before any query, migration, deployment, or production claim.

## M-007 — Dashboard could be green on partial/legacy health

- What happened: Admin health mainly reflected Kultunaut and legacy `showtimes`, while eBillet freshness and canonical `screenings` could be stale.
- Why: The dashboard used convenient existing endpoints instead of the production acceptance model.
- Rule: Overall health includes every active importer, queue state, canonical upcoming screenings, and freshness thresholds.
- Test: A stale or failed source makes the dashboard visibly require attention.

## M-008 — Extracted Supabase method lost its client binding

- What happened: The first production eBillet retry failed after promotion because an extracted `rpc` method lost the client's internal `this.rest` reference.
- Why: A type cast changed a method call into a detached function call, which local type checking and pure unit tests could not detect.
- Rule: Call SDK methods directly on their client object; never extract a stateful client method merely to satisfy a narrow type.
- Test: Every importer change includes a real production invocation and confirmation that the durable queue advances.

## M-009 — Successful retry retained an old error message

- What happened: A retried import reached `completed` but still carried the error text from its earlier failed attempt.
- Why: `completeRun` updated state and statistics without clearing `last_error`.
- Rule: A successful terminal transition clears stale failure metadata atomically.
- Test: Completed retry rows have `last_error IS NULL` after the production import.

## M-010 — Grouped times inherited another screening's tags

- What happened: Combining `Babybio` with a time filter at Empire also exposed ordinary screenings later the same day.
- Why: The read model unioned events, formats, and languages across every time in one movie/cinema/date/hall group before filtering.
- Rule: Keep physical screenings separated by their complete tag signature until every active filter has matched; merge only after filtering.
- Test: A regression test pairs a tagged noon screening with an untagged afternoon screening and requires only the tagged ticket to survive.

## M-011 — Persisted filter relabelled an explicit landing route

- What happened: Navigating from Babybio to `/for-boern` correctly kept both filters, but the children landing page still displayed the Babybio hero.
- Why: Hero copy was chosen from persisted filter state before explicit route context.
- Rule: An explicit curated landing route owns its title and description; persisted filters may narrow results but never relabel the route.
- Test: Production smoke navigation verifies `/for-boern` keeps its children hero while combined filters remain active.

## M-012 — Public listings rendered the entire catalogue into the first response

- What happened: Home and city pages server-rendered hundreds of cards and serialized detail-only film fields plus full screening rows, producing megabyte-sized HTML and multi-second response times.
- Why: The client needed the complete filter index, and that requirement was incorrectly treated as a requirement to render and serialize every rich record up front.
- Rule: Keep canonical filter data compact, render public cards progressively, defer detail-only metadata to detail routes, and cache identical public HTML briefly at the edge.
- Test: Release smoke records HTML bytes and initial card counts for home and a large city, then verifies filters and “Vis flere” still expose the complete catalogue.

## M-013 — Mistook a missing local GitHub CLI for missing repository access

- What happened: Publication was reported as blocked because the local `gh` executable was absent, even though the connected GitHub integration had administrator and push access and had already been used for prior Lanterna releases.
- Why: One preferred local tool was treated as the only valid publication path instead of checking the repository integration's actual capabilities.
- Rule: Verify both the direct GitHub integration and local tooling. When the direct integration supports branch, commit, and pull-request operations, use the traceable direct workflow rather than declaring an access blocker.
- Test: Release evidence records the verified repository permission plus the resulting branch, commit, draft PR, checks, merge, Lovable deployment, and live smoke result.

## M-014 — Parenthesized language label created a duplicate public film card

- What happened: Production rendered both `Superhunden Charlie` and `Superhunden Charlie (Dansk tale)` as separate film cards even though they represented the same film.
- Why: Public title normalization removed unparenthesized language suffixes but did not recognize the same suffix inside trailing parentheses.
- Rule: Treat a trailing parenthesized screening-language label as presentation metadata, not film identity, while preserving every source id, slug, screening, and screening-level language tag during consolidation.
- Test: The public-catalog regression suite merges the two title variants into one card, sums their screening counts, retains both source references, and keeps showtime metadata separate.

## M-015 — Live production audit created a circular pull-request gate

- What happened: The code fix for a duplicate live film card could not make its pull request green because the required catalog job kept testing the old code already deployed on `lanterna.dk`.
- Why: A production-state audit was used as a pre-merge code gate even though a pull request cannot alter production before merge and Lovable deployment.
- Rule: PR-local tests and builds are blocking before merge. Checks against the currently deployed site remain visible but advisory on pull requests; after Lovable deployment, a manually triggered CI run makes the same production checks blocking.
- Test: A pull request with a known live-only finding completes its code checks and records an advisory warning, while a manual workflow run still fails until the deployed site passes the production audit.

## M-016 — Smoke test timed out while installing Chromium

- What happened: GitHub cancelled the production smoke job after 15 minutes before any Lanterna test ran because `playwright install --with-deps` stalled while reading the runner's Ubuntu package mirror.
- Why: The workflow installed Chromium and operating-system dependencies from apt on every run instead of using a deterministic browser environment.
- Rule: Run browser CI in the official Playwright container pinned to the exact `@playwright/test` version in `package.json`; do not add a separate apt/browser installation step.
- Test: The smoke job starts Playwright directly, reaches the actual Lanterna tests, and completes within its timeout.

## M-017 — Whole-page HTML check confused filter metadata with a film card

- What happened: The non-film smoke test failed on the word `Særvisning` even though it appeared only as valid serialized screening/filter metadata, not as a public film-card title.
- Why: The assertion searched the entire server response instead of the semantic UI element it claimed to validate.
- Rule: Scope UI-quality assertions to the rendered element under test. Film-card title checks may inspect only titles inside public `/film/` card links, not filters, scripts, metadata, or screening tags.
- Test: The smoke test extracts actual film-card `<h3>` titles, requires at least one card, and allows the same vocabulary to exist in unrelated filter data.

## M-018 — Hosting policy overwrote the app's public cache header

- What happened: The server emitted `Cache-Control: s-maxage=300`, but Lovable's production proxy returned `no-cache, must-revalidate, max-age=0`, so the release smoke failed after deployment.
- Why: Application cache intent and the hosting layer's effective browser-facing header were treated as the same state.
- Rule: Verify both layers separately. Public HTML emits a dedicated `CDN-Cache-Control` directive for a future upstream cache, but Lovable managed hosting may strip it and force revalidation. Actual HTML edge caching then requires a supported external CDN/reverse proxy; never claim an edge hit without live evidence.
- Test: Unit tests verify the app directives. Production smoke records either a forwarded shared-cache policy or Lovable's explicit revalidation policy while still rejecting shared-cache directives on authentication pages.

## M-019 — Deferred film data made an active arrangement menu disappear

- What happened: A user could enter a film from `/babybio`, remove Babybio with one press, and then temporarily lose the Arrangement menu before the deferred programme facets finished loading.
- Why: The Babybio route effect activated the filter before the parent provider finished hydrating localStorage; hydration then overwrote the route value with `null`, while deferred film facets were still empty.
- Rule: Route-derived filters activate only after persisted state has hydrated. Retain the arrangement used to enter a film only for the deferred-loading window; after loading, expose only current data-backed options.
- Test: The facet unit test covers the loading boundary, and the production navigation smoke confirms Babybio survives listing → film, toggles off, and immediately reopens Arrangement.

## M-020 — Parallel production smoke created its own SSR load spike

- What happened: Two Playwright workers cold-loaded film, city, search, sitemap, and filter routes concurrently; individual navigations intermittently crossed the 30-second timeout even when the same route passed on retry.
- Why: The same parallelism used to speed up local tests was also applied to a shared production target with cold SSR/database work.
- Rule: Keep local browser checks parallel, but run external production smoke serially so the gate measures normal route behaviour rather than self-generated concurrency.
- Test: `SMOKE_BASE_URL` selects one worker and disables full parallelism; the job retains the 30-second per-test limit.

## M-021 — Active filter summary changed the group button's accessible name

- What happened: Production correctly retained Babybio after film navigation, but the smoke test still timed out looking for a button named exactly `Arrangement`.
- Why: The active selection is intentionally included in the accessible name, so the real button was named `Arrangement Babybio`; the selector encoded an inactive-state label as a permanent contract.
- Rule: When a control's accessible name includes live state, anchor selectors to the stable group prefix while allowing the user-visible state suffix.
- Test: The production navigation smoke opens the Arrangement group both while Babybio is selected and after it is cleared.

## M-022 — One smoke fixture crawled every sitemap before opening a film

- What happened: The movie-page smoke exhausted its 30-second budget before navigation because fixture discovery fetched the root index and every child sitemap, including the large city/movie matrix.
- Why: Dynamic fixture discovery was implemented as a full canonical-URL crawl even when the test needed only one movie, cinema, or city path.
- Rule: Read the smallest relevant child sitemap and cache it by section; never fetch unrelated sitemap sections to discover one smoke fixture.
- Test: Movie, cinema, city, search, and booking smoke cases request only their relevant sitemap section and retain the 30-second test boundary.

## M-023 — "Page-speed" tests measured payload boundaries, not speed

- What happened: The homepage SSR loader awaited and serialized the full national catalogue (all movies, cinemas and the complete showtime index) while the existing `page-speed` spec passed, because it only asserted card counts, horizontal overflow and cache headers.
- Why: Those assertions describe DOM/payload boundaries. They cannot observe TTFB, FCP, LCP, or transferred bytes, so a regression in cold-start cost is invisible to them.
- Rule: A performance gate must measure real timings and Core-Web-Vitals-like metrics (TTFB, FCP, LCP, navigation duration) plus transferred bytes under a documented CPU/network throttling profile. DOM- or header-only checks stay in the functional smoke suite and must never be described as page-speed coverage.
- Test: `npm run test:performance` (`playwright.performance.config.ts`, mobile viewport, 4x CPU throttling, Slow-4G profile) attaches a JSON report and fails on explicit budgets; `npm run test:smoke` remains functional and deterministic.

## M-024 — Fixed eBillet start attempts had no stale self-recovery

- What happened: The 01:00 daily eBillet start and the 01:10 retry both dispatched, but neither created a new organizer cycle. The five-minute resume worker then kept finding no work to drain until the application-level freshness monitor paged.
- Why: Resume was prohibited from ever creating fresh work, so recovery still depended entirely on two fixed-time start requests.
- Rule: eBillet resume stays drain-only while data is fresh, but when no organizer work is active it may start one recovery cycle only after the newest completed organizer is at least 24 hours old.
- Test: Runner tests cover strict resume, pre-threshold recovery, threshold recovery and no-history bootstrap; production verification must confirm a fresh completed cycle, zero active/dead-letter jobs and a healthy strict import monitor.

## M-025 — Published Lovable before the exact merge commit had synced

- What happened: After PR #88 merged, a Lovable publish was started while its matching `developer_update` was still pending and the project code still resolved to the previous #87 commit. That publish could not be valid evidence for the new code.
- Why: GitHub merge completion was treated as if Lovable repository synchronization were instantaneous.
- Rule: Before publishing, require the exact merged `main` SHA to appear in Lovable as a `developer_update` with status `completed`, then verify the current project code/ref is that revision. Never publish a pending or stale ref.
- Test: Release evidence records the merged SHA, matching completed Lovable developer update, current Lovable ref/code verification, and only then the publish/deployment id.

## M-026 — Green PR wrapper was mistaken for a passed performance gate

- What happened: A performance test process exited non-zero, but `continue-on-error` correctly kept the pull-request job wrapper green. The green wrapper was initially read as if the measured performance budgets had passed.
- Why: GitHub job conclusion and the inner performance-step outcome were conflated, despite PR production checks being intentionally advisory.
- Rule: Never infer performance success from a PR job's green wrapper. Read the explicit performance gate summary and concrete route metrics. A PR `ADVISORY FAIL` remains a failure of the measured production state, just not a merge blocker.
- Test: CI always writes `PERFORMANCE GATE: PASS`, `ADVISORY FAIL`, or `BLOCKING FAIL` plus the concrete metric lines to the step summary.

## M-027 — PR workflow rerun was treated as blocking post-deploy verification

- What happened: A pull-request CI workflow was rerun after a production deployment and used as post-deploy evidence. Its event type was still `pull_request`, so live failures remained advisory by design.
- Why: Rerunning a job was assumed to change its release semantics; GitHub preserves the original workflow event.
- Rule: A blocking post-deploy gate must be a fresh manual `workflow_dispatch` run after Lovable deployment. Rerunning a PR workflow never substitutes for it.
- Test: Final release evidence links a post-deploy `workflow_dispatch` CI run whose production catalog, parity, smoke and performance checks are blocking.

## M-028 — Polling and repeated full-pipeline loops inflated delivery time

- What happened: External job status was checked repeatedly while unchanged, and full smoke/performance cycles were repeated during an evolving diagnosis. The extra calls did not make GitHub runners, Lovable synchronization, or tests complete sooner.
- Why: Observation was treated as progress, and diagnosis/implementation/release verification were not kept as separate stages.
- Rule: Use targeted evidence and narrow checks while diagnosing and implementing; run one full PR verification for a coherent candidate; after exact-commit Lovable sync publish once; then run one fresh blocking production cycle. Permit at most one clean rerun for a narrow timing-only miss unless new evidence justifies further diagnosis.
- Test: The PR/release record shows the targeted check, coherent PR verification, exact synced SHA, one intended publish and one blocking post-deploy run; any extra rerun states the specific variance being tested.

## M-029 — Assumed one removed image would subtract the same bytes from total transfer

- What happened: Removing a ~756 KB raw Kultunaut poster was expected to reduce total `/koebenhavn` transfer by roughly the same amount, but the browser then had time to complete additional native-lazy TMDb poster requests, so total transfer fell much less on the first fix.
- Why: Network scheduling and lazy-loading behaviour were ignored; request-level arithmetic was used as a proxy for a new end-to-end trace.
- Rule: For performance work, measure the complete post-change request set. Never predict the final transfer budget solely by subtracting one known resource from the previous total.
- Test: Performance release evidence includes a fresh trace or resource breakdown when request scheduling can materially change, plus the final measured route totals.
