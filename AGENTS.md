# Lanterna delivery rules

## Mandatory session startup and crash safety

- Treat GitHub as the source of truth and the chat as disposable. Never rely on conversation memory as the only record of in-progress work.
- Before any repository write, code edit, migration draft, or write-capable tool action, read this file and `MISTAKES.md`. For broad cross-system work, also read `CURRENT_STATE.md`. Before filter work, also read `FILTER_PRINCIPLES.md`. If these files have not been read in the current work session, do not edit yet.
- At the first write-capable step, fetch/confirm current `main`, inspect open PRs for overlapping work, and create or reuse exactly one isolated `agent/<description>` branch. Never postpone branch creation until after files have already been changed. Never develop directly on `main`.
- If the connected GitHub integration can create the branch, create it rather than asking the user to do Git plumbing manually. If no safe branch-creation path is available, stop before any write and tell the user exactly what is blocked.
- Keep one independently releasable work item per branch. If the user adds a materially separate objective, checkpoint the current branch/PR first and recommend a separate Git branch and, when useful, a fresh/branched chat for the new work.
- Checkpoint after every coherent implementation stage: commit only the intended files to the feature branch and keep a draft PR with an up-to-date summary of completed work, validation, remaining work, and the exact resume point. Do not accumulate several independent uncommitted stages in one chat.
- Proactively recommend a fresh/branched chat **before** context becomes unreliable when any of these signals appear: three or more independent objectives in one session; more than roughly ten changed files across unrelated areas; repeated tool failures or repeated re-reading/reconstruction of earlier decisions; multiple release/deploy phases mixed with new implementation; or the assistant can no longer state the branch, current diff, completed checks, and remaining acceptance items without reconstructing them from chat history.
- A chat handoff is not a failure state. Before recommending it, first leave GitHub in a resumable state: branch exists, intended changes are committed, draft PR/status is current, and no uncommitted production-critical work exists. The handoff message must name the repository, branch/PR, protected areas, checks already run, and the next exact action.
- After a crash, new chat, or context loss, do not continue from memory. Re-read the rule files, inspect current `main`, the relevant branch/PR, complete diff, checks, and deployment state, then continue from that evidence.
- Read-only investigations must remain read-only. Do not modify tracked files, generated plans, `.lovable/plan.md`, project settings, database state, or deployment state while merely auditing or diagnosing. If a write becomes necessary, create the branch/checkpoint first and make the write explicit.
- Keep `main` releasable. Never merge a branch that still contains unresolved TODO work required by the agreed scope, known failing required checks, unreviewed accidental file changes, or an incomplete deployment prerequisite.

Read `FILTER_PRINCIPLES.md` and `MISTAKES.md` before changing filters, imports, analytics, SEO, or the admin area. For broad cross-system work, also read `CURRENT_STATE.md` for the latest dated architecture/audit orientation; re-verify its mutable production facts before relying on them.

## Completion gate

- Keep the user's original acceptance list intact. Do not silently redefine or narrow it.
- Never mark a group of tasks complete while an agreed deliverable is missing, placeholder-only, or unverified in production.
- Report partial status explicitly: implemented, verified locally, deployed, and verified in production are different states.

## GitHub delivery

- Start every work item by fetching `origin/main`, confirming the current production baseline, and creating one isolated `agent/<description>` branch. Never develop directly on `main`.
- Inspect `git status` and the complete diff before staging. Preserve unrelated user changes and stage only files that belong to the agreed scope.
- Before publication, run the relevant unit tests, type checks, lint, production build, responsive checks, and route/data smoke tests. Record any environment-limited check explicitly.
- Publish every change through one traceable commit, a pushed branch, and a draft pull request. The PR must explain what changed, why, user impact, root cause, validation evidence, remaining work if any, and the exact resume point for another chat/agent.
- Before starting a new branch for an existing problem, inspect open PRs and recent branches. Reuse a current matching branch/PR when safe; do not duplicate partially completed work merely because the original chat ended.
- Prefer the connected direct GitHub integration for repository reads, branch/commit publication, and pull-request creation. A missing local `gh` executable is not proof that GitHub access is unavailable.
- If local GitHub tooling is unavailable, verify the connected GitHub integration's repository permission and use its direct branch/commit/PR workflow. Stop only when neither the direct integration nor an authenticated local path can publish safely.
- Never push directly to `main`. Merge only after required checks against the PR code pass and the PR scope matches the reviewed local diff.
- Checks that read the already deployed `lanterna.dk` are advisory during a pull request because they cannot observe the proposed code. They must stay visible, but must never create a circular gate that prevents the fix from reaching production.
- Treat an app-emitted cache directive and the effective hosting policy as separate states. Lovable may replace the browser-facing `Cache-Control`; verify the live response, use `CDN-Cache-Control` for an upstream shared-cache policy, and never claim an actual edge-cache hit without production evidence.
- Run external production smoke tests serially. Parallel cold SSR navigation can create its own load spike and turn the release gate into a test of self-generated concurrency instead of normal route behaviour.
- Run Playwright CI jobs in the official Playwright container pinned to the repository's exact `@playwright/test` version. Do not reinstall browsers and OS packages through the runner's apt mirrors on every run.
- After merge, deploy the frontend through Lovable's **Update** publish flow. Deploy Supabase migrations/functions separately through Lovable, then manually run the GitHub CI workflow. In that post-deploy run, production audit and smoke jobs are blocking and must pass.
- A task is complete only when the states are reported separately: implemented, locally verified, published in a PR, merged, deployed, and production-verified.

## Efficient implementation and release loop

- Separate **diagnosis**, **implementation**, and **release verification**. Do not repeatedly run the full production pipeline while the root cause or candidate fix is still changing.
- During diagnosis, collect the smallest evidence that can identify the bottleneck or failure. For performance work, inspect one representative route/trace and the concrete transferred resources before editing. Do not infer byte savings from one removed request when browser scheduling can change which other requests complete.
- During implementation, use the narrowest relevant checks first (targeted unit/spec, typecheck/build as needed). Run the full PR verification suite once the candidate solution is coherent, not after every exploratory edit.
- Do not poll queued or in-progress GitHub/Lovable work repeatedly. Re-check only when a meaningful stage could have changed or another useful task has completed. Status polling is observation, not progress.
- On PRs, production smoke/performance jobs are **advisory even when the GitHub job wrapper is green**. Never infer a production-performance pass from the job conclusion alone. Read the `Performance gate summary` and its concrete metrics; `ADVISORY FAIL` is not a pass.
- A rerun of a pull-request workflow remains a pull-request workflow and therefore remains advisory. It is **not** the blocking post-deploy gate, even if it is rerun after production changed. After deployment, use a fresh manual `workflow_dispatch` run for blocking production verification.
- Before any Lovable frontend publish, confirm that Lovable has registered the **exact merged `main` commit** as a `developer_update` with status `completed`, and verify the current project code/ref resolves to that commit. Never publish while the matching developer update is `pending`, and never assume GitHub merge implies Lovable sync has finished.
- One intended merge gets one intended Lovable publish. If a publish was started from a stale Lovable ref, treat it as invalid evidence and do not compound it with further speculative deploys; wait for exact-commit sync, then publish once.
- After deployment, run one fresh blocking production verification cycle. If a timing-only metric misses narrowly while transfer/content/functionality are stable, one clean rerun is allowed to distinguish measurement variance from regression. Repeated reruns are not a substitute for diagnosis.
- Performance completion requires the concrete measured budgets to pass, not merely a green wrapper/check. Once the acceptance criteria and required gates pass, stop; do not continue optimizing or rerunning without a new objective.

## Lovable token / credit usage

- **Never use Lovable AI tokens or credits.** Do not invoke Lovable's AI agent for implementation, debugging, analysis, testing, planning, code edits, or repository work.
- Do not use Lovable agent/message/variant/project-generation actions when they can consume tokens or credits. Use the direct GitHub integration for code work instead.
- Lovable may only be used for non-AI platform operations that are strictly required by this project, such as accessing the project's connected Supabase database, checking sync/status, and publishing/deploying — and only when those operations do not consume Lovable AI tokens or credits.
- Before any Lovable operation, classify it as required non-AI platform work or prohibited/uncertain AI-credit work. If it is unclear whether the operation consumes tokens or credits, treat it as chargeable and **do not use it**.
- Do not invoke Lovable merely to inspect code, reason about a bug, run repository analysis, generate a plan, or test an idea that GitHub/tests/direct tools can handle.
- Do not tell the user to click Lovable Update/Publish during exploratory work. Ask for or perform deployment only after the GitHub branch/PR is in the correct release state and the exact deploy purpose is known.
- Never spend Lovable tokens or credits for convenience, speed, or because a GitHub/direct-tool workflow is more cumbersome.

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
