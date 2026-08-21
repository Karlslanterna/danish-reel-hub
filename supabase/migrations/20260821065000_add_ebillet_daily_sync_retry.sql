-- Retry the canonical eBillet daily cycle once, 10 minutes after the primary
-- 01:00 UTC start. The application enforces a 15-minute minimum interval
-- between completed cycles, so this call is a no-op when the primary start
-- succeeds and a recovery path when the first HTTP/RPC start fails.

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'ebillet-canonical-daily-sync-retry';

  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'ebillet-canonical-daily-sync-retry',
  '10 1 * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://lanterna.dk/api/public/ebillet-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-ebillet-mode', 'sync',
        'x-import-scheduler-token', (
          SELECT value FROM public.scheduler_secrets WHERE name = 'kultunaut_cron'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cron$
);
