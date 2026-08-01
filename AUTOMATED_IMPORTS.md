# Automated Kultunaut Imports (Deployment item C1)

Fully automated daily imports of the Kultunaut catalog. The import logic
itself is unchanged — the scheduler only *drives* the existing pipeline
(`createImportJob` → `processJobBatch` in `src/lib/kultunaut/import.server.ts`).

---

## 1. Scheduling mechanism

| Piece | Where |
| --- | --- |
| Cron jobs | Postgres `pg_cron` + `pg_net` (jobs `kultunaut-daily-import`, `kultunaut-import-resume`) |
| Trigger endpoint | Existing `POST /api/public/kultunaut-import` with header `x-kultunaut-mode: scheduled` (no new public endpoint) |
| Orchestration | `src/lib/kultunaut/scheduler.server.ts` |
| Run log | `public.import_schedule_runs` |
| Feed source | `KULTUNAUT_FEED_URL` secret (server-side only) |

Schedule:

- `kultunaut-daily-import` — `0 2 * * *` (02:00 UTC daily). Starts a run.
- `kultunaut-import-resume` — `*/5 * * * *`. **Only** resumes a run that is
  already in progress; it never starts a new import. This exists because a
  single Worker invocation has a wall-clock budget of 120 s; large catalogs
  are drained across several invocations.

No manual intervention is required at any point.

### Flow of one run

1. Claim a row in `import_schedule_runs` with `status='running'`.
2. Fetch the XML feed from `KULTUNAUT_FEED_URL` (with retries).
3. `createImportJob(xml)` — the existing pipeline, unchanged.
4. Loop `processJobBatch(jobId)` until the job reports `done`/`completed`,
   or until the 120 s budget is reached (then the run stays `running` and
   the 5-minute resume job continues it).
5. Mark the run `completed` / `failed` with finish time and duration.
6. Call `getImportHealth()` so `/api/public/import-health` reflects the run
   immediately and logs any health state transition.

---

## 2. Retry policy

- **Feed fetch:** up to 3 attempts, exponential backoff 1 s → 2 s → 4 s.
- **Batch processing:** each `processJobBatch` call gets up to 3 attempts
  with the same backoff. Only after 3 consecutive failures is the run
  marked `failed`.
- Retries are per operation, so a transient network blip never fails a run.
- Constants live at the top of `scheduler.server.ts`
  (`MAX_ATTEMPTS`, `BASE_BACKOFF_MS`, `WALL_CLOCK_BUDGET_MS`).

---

## 3. Concurrency protection

Three independent guards:

1. **Database-level:** the unique partial index
   `import_schedule_runs_single_running` allows at most one row with
   `status='running'`. A second concurrent claim fails and is recorded as
   `skipped`.
2. **In-flight run:** if a run is already `running`, the trigger resumes
   that run instead of starting a new one.
3. **Manual imports:** if any `import_jobs` row is `queued` or `running`
   (e.g. an admin upload via `/admin/import`), the scheduled run is
   **skipped** and the reason is written to `import_schedule_runs.reason`
   and logged (`event: run_skipped`).

Stale protection: a run stuck in `running` for more than 6 hours is closed
out as `failed` with reason "Run abandoned…", freeing the next daily run.

---

## 4. Failure handling & logging

Every scheduled run writes one row to `public.import_schedule_runs`:

| Column | Meaning |
| --- | --- |
| `status` | `running` / `completed` / `failed` / `skipped` |
| `trigger` | `cron`, `resume`, `manual` |
| `job_id` | The `import_jobs` row this run created |
| `attempts` | Batches processed (incl. retries) |
| `reason` | Why it failed or was skipped (null on success) |
| `started_at`, `finished_at`, `duration_seconds` | Timing |

Structured JSON lines are emitted to the server log for every step:
`run_started`, `feed_fetched`, `feed_fetch_failed`, `job_created`,
`batch_failed`, `run_paused`, `run_resumed`, `run_skipped`,
`run_stale_failed`, `run_finished` — each with `scope: "import-scheduler"`.

The endpoint returns HTTP 500 for a failed run, so `cron.job_run_details`
also records the failure.

---

## 5. Monitoring

`GET /api/public/import-health` now returns:

```jsonc
{
  "status": "healthy|warning|critical|unknown", // worst of import + scheduler
  "importStatus": "…",                          // pipeline-only status (unchanged logic)
  "metrics": { /* unchanged */ },
  "scheduler": {
    "status": "…",
    "reasons": ["…"],
    "lastRunAt": "…",
    "lastRunStatus": "completed",
    "lastSuccessAt": "…",
    "hoursSinceLastSuccess": 3.2
  }
}
```

Scheduler thresholds (in `getSchedulerHealth`):

| Condition | Status |
| --- | --- |
| No scheduled run ever recorded | `unknown` |
| Last successful scheduled run ≥ 26 h ago | `warning` |
| Last successful scheduled run ≥ 48 h ago, or none on record | `critical` |
| Last run failed | `warning` |
| ≥ 2 consecutive failed runs | `critical` |

A scheduler that never fires therefore drives the endpoint to `503`, which
is exactly what an uptime monitor should page on.

---

## 6. Security

- **No new public endpoint.** The scheduler reuses
  `POST /api/public/kultunaut-import` with a mode header.
- Scheduled/resume requests authenticate with a token generated **inside
  Postgres** (`public.scheduler_secrets`, service-role only, RLS on with no
  policies). The token never leaves the backend — pg_cron reads it from the
  table when building the request header, and the route verifies it with a
  constant-time comparison.
- The existing `x-kultunaut-secret` env token remains accepted for manual
  operator triggers, so the existing auth model is unchanged.
- Run history is admin-readable only (`has_role(auth.uid(),'admin')`).

---

## 7. How to disable or pause scheduled imports

```sql
-- Pause (keeps the definition):
UPDATE cron.job SET active = false
 WHERE jobname IN ('kultunaut-daily-import','kultunaut-import-resume');

-- Resume:
UPDATE cron.job SET active = true
 WHERE jobname IN ('kultunaut-daily-import','kultunaut-import-resume');

-- Remove entirely:
SELECT cron.unschedule('kultunaut-daily-import');
SELECT cron.unschedule('kultunaut-import-resume');
```

Emergency stop without touching cron: rotate the token —
`UPDATE public.scheduler_secrets SET value = encode(gen_random_bytes(32),'hex') WHERE name='kultunaut_cron';`
is *not* enough (cron reads the current value), so instead clear the feed:
unset `KULTUNAUT_FEED_URL`. Runs then fail fast and are logged, and health
turns critical — visible rather than silent.

To change the time, unschedule and re-schedule with a new cron expression.

---

## 8. How to verify the scheduler is working

```sql
-- 1. Jobs exist and are active
SELECT jobid, jobname, schedule, active FROM cron.job;

-- 2. Cron actually fired (HTTP dispatch level)
SELECT jobid, status, return_message, start_time
FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;

-- 3. Application-level run log
SELECT status, trigger, job_id, attempts, reason,
       started_at, finished_at, duration_seconds
FROM public.import_schedule_runs ORDER BY started_at DESC LIMIT 10;

-- 4. The import job the run created
SELECT id, status, phase, processed_movies, processed_cinemas, processed_showtimes
FROM public.import_jobs ORDER BY created_at DESC LIMIT 5;
```

Then check the health endpoint:

```bash
curl -s https://lanterna.dk/api/public/import-health | jq '.status, .scheduler'
```

Expected within 24 h of the first successful run:
`status: "healthy"`, `scheduler.lastRunStatus: "completed"`,
`scheduler.hoursSinceLastSuccess < 26`.

**Force a run now (operator, no waiting):**

```sql
SELECT net.http_post(
  url := 'https://project--064d1982-2d69-459e-a2f3-a9c092d237c3.lovable.app/api/public/kultunaut-import',
  headers := jsonb_build_object(
    'Content-Type','application/json',
    'x-kultunaut-mode','scheduled',
    'x-kultunaut-cron-token',(select value from public.scheduler_secrets where name='kultunaut_cron')
  ),
  body := '{}'::jsonb
);
```

---

## 9. Prerequisite

`KULTUNAUT_FEED_URL` must be set to the XML feed the importer should pull
each night. Without it every run fails fast with
`KULTUNAUT_FEED_URL is not configured`, which is logged and surfaced as a
critical health status.
