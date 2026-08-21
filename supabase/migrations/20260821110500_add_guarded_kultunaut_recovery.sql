-- Retry the Kultunaut daily start once at 02:10 UTC, but only when the
-- application-level canonical feed has no recent successful completion.
--
-- This deliberately does NOT trust pg_cron dispatch status: pg_cron only queues
-- the asynchronous HTTP request. `import_runs` is the canonical application
-- truth. If 02:00 succeeded (or a recent manual canonical feed import succeeded),
-- this statement sends no HTTP request. If the primary dispatch never reached
-- the app or failed before a completed feed run, the existing `scheduled` route
-- gets one recovery chance. If the primary run is still in flight, the existing
-- scheduler safely resumes it instead of creating a parallel run.

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'kultunaut-daily-import-recovery';

  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'kultunaut-daily-import-recovery',
  '10 2 * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://project--064d1982-2d69-459e-a2f3-a9c092d237c3.lovable.app/api/public/kultunaut-import',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-kultunaut-mode', 'scheduled',
        'x-kultunaut-cron-token', (
          SELECT value FROM public.scheduler_secrets WHERE name = 'kultunaut_cron'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 150000
    )
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.import_runs
      WHERE source = 'kultunaut'
        AND scope_type = 'feed'
        AND state = 'completed'
        AND finished_at >= now() - interval '6 hours'
    );
  $cron$
);
