# Automated imports — current operations guide

Verified against production during the 2026-08-21 system audit. For broad architecture/current-state context, read `CURRENT_STATE.md`. Re-check production before reporting mutable status.

This file documents **operational semantics**, not a promise that the latest scheduled run succeeded.

## Authoritative rule

`pg_cron` and `pg_net` are dispatch infrastructure. A row in `cron.job_run_details` with `status='succeeded'` proves that the cron SQL ran and queued its `net.http_post` request. It does **not** prove that the downstream HTTP endpoint returned 2xx, created an import run, or completed an import.

Therefore never use `cron.job_run_details` alone to declare an importer healthy.

For current import truth, inspect in this order:

1. canonical application run state (`import_runs` and source-specific run state);
2. Kultunaut orchestration state (`import_schedule_runs`) where applicable;
3. canonical `screenings` freshness, source counts and forward horizon;
4. `/api/public/import-health`;
5. `pg_cron` only to answer whether dispatch SQL fired.

This distinction is important: during the 2026-08-21 audit both eBillet and Kultunaut had examples where scheduler infrastructure could look healthy while the application-level import was stale or absent.

## Kultunaut scheduler

Current production topology at the audit snapshot:

| Job | Schedule | Purpose |
| --- | --- | --- |
| `kultunaut-daily-import` | `0 2 * * *` | Start daily import at 02:00 UTC |
| `kultunaut-import-resume` | every 2 minutes in its configured 02–04 UTC window | Resume an already-running import that exceeded one worker invocation |

The trigger reuses `POST /api/public/kultunaut-import` in scheduler mode and authenticates with the backend scheduler token. The orchestrator lives in `src/lib/kultunaut/scheduler.server.ts`.

A normal application-level run is represented in `public.import_schedule_runs` and creates/continues the underlying import work. Large feeds may be drained across several invocations.

### Important retry constraint

Do **not** add a blind second daily Kultunaut start (for example another unconditional 02:10 call). The current scheduler can start a new full run once no run is active; a blind retry after a successful 02:00 cycle could therefore duplicate work.

If a recovery start is added, it must be guarded by current application state — e.g. start only when no successful current-cycle run exists and no run is active.

## eBillet scheduler

Current production topology at the audit snapshot:

| Job | Schedule | Purpose |
| --- | --- | --- |
| `ebillet-canonical-daily-sync` | `0 1 * * *` | Start daily canonical organizer cycle |
| `ebillet-canonical-daily-sync-retry` | `10 1 * * *` | Guarded recovery start at 01:10 UTC |
| `ebillet-canonical-resume` | every 5 minutes | Drain queued organizer runs |

The 01:10 retry is safe because the eBillet application layer enforces a minimum interval between completed cycles; after a successful 01:00 cycle the retry is a no-op.

## Kultunaut application run flow

The scheduler/orchestrator is responsible for:

1. claiming or resuming the application-level scheduled run;
2. fetching the configured Kultunaut XML feed;
3. creating/continuing the import job;
4. processing batches within the worker wall-clock budget;
5. leaving the run resumable when more work remains;
6. marking the application run completed/failed with timing/reason;
7. updating import-health state.

Concurrency protection in the application/database layer is more important than cron status. Do not create parallel manual/scheduled runs without checking current canonical run state.

## Failure semantics

A failed downstream HTTP request can coexist with a green `cron.job_run_details` row because `pg_net` executes the HTTP request asynchronously after cron has queued it.

Consequences:

- “cron succeeded” is **not** an import success signal;
- a missing `import_schedule_runs` row after a daily Kultunaut dispatch is suspicious even if cron is green;
- freshness/horizon alarms must be driven by application data;
- any uptime/alerting system should watch `/api/public/import-health` or an equivalent application-level monitor, not pg_cron success alone.

`net._http_response` may help diagnose recent asynchronous HTTP responses when retained, but it is not the long-term source of truth for successful data ingestion.

## Verification queries

All production SQL must be run through Lovable's connected Supabase project per `AGENTS.md`.

```sql
-- 1. Current cron definitions: dispatch infrastructure only
SELECT jobid, jobname, schedule, active
FROM cron.job
ORDER BY jobid;

-- 2. Did the cron SQL fire? Still not proof the HTTP/import succeeded.
SELECT jobid, status, return_message, start_time, end_time
FROM cron.job_run_details
ORDER BY start_time DESC
LIMIT 30;

-- 3. Kultunaut application-level scheduled runs
SELECT status, trigger, job_id, attempts, reason,
       started_at, finished_at, duration_seconds
FROM public.import_schedule_runs
ORDER BY started_at DESC
LIMIT 20;

-- 4. Canonical application runs across current sources
SELECT source, state, scope_type, scope_key,
       attempts, created_at, updated_at, finished_at, last_error, stats
FROM public.import_runs
ORDER BY created_at DESC
LIMIT 100;

-- 5. Source freshness/horizon in the canonical read model
SELECT source,
       count(*) AS screenings,
       min(local_date) AS first_date,
       max(local_date) AS last_date
FROM public.screenings
WHERE starts_at >= now()
GROUP BY source
ORDER BY source;
```

Then inspect the public application health response:

```bash
curl -s https://lanterna.dk/api/public/import-health
```

Do not declare the pipeline healthy from one query. The acceptance check is that each active source has a recent successful application run **and** plausible current/future canonical screenings.

## Stale/nonterminal run cleanup

A historical run can remain queued or otherwise nonterminal even after newer runs succeed. Such an orphan may not currently degrade public data but can mislead operators and future audits.

Use a deliberate retention/terminalization policy for stale runs; do not delete an active run merely because it is old without first checking leases/heartbeats/current importer state.

## Pause / emergency operations

Prefer pausing specific cron jobs rather than breaking authentication or feed secrets.

```sql
UPDATE cron.job
SET active = false
WHERE jobname IN (
  'kultunaut-daily-import',
  'kultunaut-import-resume',
  'ebillet-canonical-daily-sync',
  'ebillet-canonical-daily-sync-retry',
  'ebillet-canonical-resume'
);
```

Resume only the jobs intentionally paused after validating the application-level state.

## What future chats must not do

- Do not infer import health from `pg_cron` success.
- Do not use legacy `showtimes` as the primary production read model.
- Do not query a separately connected Supabase project; production SQL goes through Lovable.
- Do not start duplicate full imports merely to “make sure” a scheduled run happened.
- Do not call an import fix complete until the affected source is re-imported and canonical production data is verified.
