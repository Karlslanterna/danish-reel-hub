# Lanterna delivery rules

Read `FILTER_PRINCIPLES.md` and `MISTAKES.md` before changing filters, imports, analytics, SEO, or the admin area.

## Completion gate

- Keep the user's original acceptance list intact. Do not silently redefine or narrow it.
- Never mark a group of tasks complete while an agreed deliverable is missing, placeholder-only, or unverified in production.
- Report partial status explicitly: implemented, verified locally, deployed, and verified in production are different states.

## GitHub delivery

- Start every work item by fetching `origin/main`, confirming the current production baseline, and creating one isolated `agent/<description>` branch. Never develop directly on `main`.
- Inspect `git status` and the complete diff before staging. Preserve unrelated user changes and stage only files that belong to the agreed scope.
- Before publication, run the relevant unit tests, type checks, lint, production build, responsive checks, and route/data smoke tests. Record any environment-limited check explicitly.
- Publish every change through one traceable commit, a pushed branch, and a draft pull request. The PR must explain what changed, why, user impact, root cause, and validation evidence.
- Prefer the connected direct GitHub integration for repository reads, branch/commit publication, and pull-request creation. A missing local `gh` executable is not proof that GitHub access is unavailable.
- If local GitHub tooling is unavailable, verify the connected GitHub integration's repository permission and use its direct branch/commit/PR workflow. Stop only when neither the direct integration nor an authenticated local path can publish safely.
- Never push directly to `main`. Merge only after required checks against the PR code pass and the PR scope matches the reviewed local diff.
- Checks that read the already deployed `lanterna.dk` are advisory during a pull request because they cannot observe the proposed code. They must stay visible, but must never create a circular gate that prevents the fix from reaching production.
- Treat an app-emitted cache directive and the effective hosting policy as separate states. Lovable may replace the browser-facing `Cache-Control`; verify the live response, use `CDN-Cache-Control` for an upstream shared-cache policy, and never claim an actual edge-cache hit without production evidence.
- Run Playwright CI jobs in the official Playwright container pinned to the repository's exact `@playwright/test` version. Do not reinstall browsers and OS packages through the runner's apt mirrors on every run.
- After merge, deploy the frontend through Lovable's **Update** publish flow. Deploy Supabase migrations/functions separately through Lovable, then manually run the GitHub CI workflow. In that post-deploy run, production audit and smoke jobs are blocking and must pass.
- A task is complete only when the states are reported separately: implemented, locally verified, published in a PR, merged, deployed, and production-verified.

## Filters and data

- Use one shared filter state across internal navigation. A selected filter must survive navigation to film, city, and cinema pages until the user removes it.
- Every page that displays screenings must apply every relevant active filter through the same matching rules.
- An active option can be removed with one press on that option. Do not add separate close icons to filter buttons.
- Only show filter options that yield a current result in the relevant page context.
- Public special filters are limited to Babybio, Seniorbio, Filmporten, and Biografklub Danmark unless the product scope is explicitly changed.
- Babybio and Seniorbio are screening attributes. Never infer them from time of day alone.
- Filmporten and Biografklub Danmark are curated film programmes. Validate them against the current official programme, with a dated review marker.
- Validate representative official examples and actual production rows before declaring data labelling correct.
- A parser change is incomplete until affected production data has been re-imported and checked.
- Confirm the actual production project and canonical read model before querying, migrating, or reporting database status.

## Supabase access

- Always access Lanterna's Supabase project through Lovable's Supabase connection. Lovable is the source of truth for the correct production database.
- Never query, migrate, deploy functions to, or report production status from a separately connected Supabase project or MCP project, even if its display name is "Lanterna".
- Database inspection, SQL, migrations, function deployment, logs, imports, and production verification must all use the Supabase project reached through Lovable.
- If Lovable's Supabase connection is unavailable, stop and report the access blocker instead of substituting another project.

## Admin, SEO, and tracking

- Admin language is plain Danish. Operational health must use canonical screenings and every active data source, not legacy tables or a single importer.
- Analytics may record page views, filter use, zero-result states, and outbound ticket clicks. Do not collect sensitive personal data.
- Index only stable, curated landing pages with real content and current results. Filter combinations are not indexable pages.
- Release only after unit tests, build/type checks, responsive checks, and a production smoke test pass.
