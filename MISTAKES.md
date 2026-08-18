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
- Rule: Confirm project id, canonical tables, and a known current row before using database results.
- Test: Release notes record the production project id and verify the `screenings` read model exists.

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
