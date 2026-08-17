-- pg_net defaults to a 5s request timeout, while one canonical eBillet batch
-- intentionally has a ~55s server budget. Successful organizer work can
-- therefore be aborted by the scheduler client before the route finishes.
-- Keep the server budget and give pg_net enough time to receive the response.

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'ebillet-canonical-daily-sync';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;

  v_jobid := NULL;
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'ebillet-canonical-resume';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'ebillet-canonical-daily-sync',
  '0 1 * * *',
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

SELECT cron.schedule(
  'ebillet-canonical-resume',
  '*/5 * * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://lanterna.dk/api/public/ebillet-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-ebillet-mode', 'resume',
        'x-import-scheduler-token', (
          SELECT value FROM public.scheduler_secrets WHERE name = 'kultunaut_cron'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cron$
);
