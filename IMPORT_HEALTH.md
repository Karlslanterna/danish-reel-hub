# Import Health Monitoring

Automatic health checks for the Kultunaut import pipeline. **Read-only** —
this module never mutates `import_jobs` and never changes import logic.

## Endpoints

| Route | Purpose | Auth |
| --- | --- | --- |
| `GET /api/public/import-health` | JSON report for uptime monitors and dashboards | Public (no PII exposed) |

HTTP status codes: `200` for `healthy` / `warning`, `503` for `critical`,
`500` on internal check failure. Point any uptime monitor (Better Stack,
UptimeRobot, cron-job.org) at this URL and alert on non-2xx.

## Monitored metrics

Sourced from the `import_jobs` table only:

- **Last successful import time** — `lastSuccessAt`, `hoursSinceLastSuccess`
- **Import duration** — `lastDurationSeconds`, `avgDurationSeconds` (avg of
  the last 5 completed imports)
- **Movies imported** — `lastMovies`, `avgMovies`
- **Cinemas imported** — `lastCinemas`, `avgCinemas`
- **Showtimes imported** — `lastShowtimes`, `avgShowtimes`
- **Failed imports** — `failedLast24h`
- **Consecutive failures** — `consecutiveFailures` (streak of failed jobs
  since the newest completed one)

## Status classification

Three health levels; the worst signal wins.

| Signal | Warning | Critical |
| --- | --- | --- |
| Hours since last success | ≥ 26h | ≥ 48h |
| Consecutive failures | ≥ 1 | ≥ 2 |
| Last movies count | — | 0 |
| Last cinemas count | — | 0 |
| Last showtimes count | — | 0 |
| Drop vs recent avg (movies/cinemas/showtimes) | ≥ 50% | ≥ 80% |
| Duration vs recent avg | ≥ 1.5× | ≥ 3× |
| Absolute duration | ≥ 20 min | ≥ 60 min |

Thresholds live in `THRESHOLDS` in `src/lib/kultunaut/health.server.ts`
— tune them there.

`unknown` is returned only when no import job has ever been recorded.

## State transition log

Every change in status is appended to `public.import_health_events`:

- `status`, `previous_status`
- `reasons[]` — human-readable check output
- `job_id` — most recent job at check time
- `metrics` — full JSON snapshot
- `created_at`

Rows are also emitted as structured `console.log` lines
(`[import-health] state healthy → warning: ...`) so they land in the
worker logs alongside other errors captured by `ERROR_MONITORING.md`.

Read access: admins only (via `has_role`). Writes: server (service role).

## Verifying the monitoring

1. **Endpoint smoke test**
   ```bash
   curl -i https://lanterna.dk/api/public/import-health
   ```
   Expect `200 OK` with a JSON body containing `status`, `reasons`,
   `metrics`, `checkedAt`.

2. **Force a warning transition** — the freshness rule is the easiest to
   exercise. In the DB, temporarily backdate the newest successful job:
   ```sql
   UPDATE public.import_jobs
     SET updated_at = now() - interval '30 hours'
     WHERE id = '<latest-completed-job-id>';
   ```
   Hit the endpoint again → `status: "warning"`, reason mentions
   `Last success was 30.0h ago`. Roll back the update afterward.

3. **Confirm the transition was logged**
   ```sql
   SELECT created_at, previous_status, status, reasons
     FROM public.import_health_events
     ORDER BY created_at DESC
     LIMIT 5;
   ```
   Expect exactly one new row per transition (the endpoint is idempotent
   within a status — no row is inserted if the status did not change).

4. **Critical path** — bump `updated_at` to `now() - interval '3 days'`
   and confirm the endpoint returns HTTP `503` and a `critical` status.

5. **Zero-import anomaly** — set `processed_movies = 0` on the latest
   completed job and re-check; reason should read
   `Latest import produced zero movies` with `status: "critical"`.

## What this does NOT do

- Does not modify import logic in `src/lib/kultunaut/import.server.ts`.
- Does not send emails/Slack/PagerDuty directly — wire the endpoint into
  an existing uptime monitor for paging.
- Does not scrape XML or expose PII / ticket URLs / user data.
