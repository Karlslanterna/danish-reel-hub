-- Canonical eBillet scheduling.
--
-- One daily `sync` call is allowed to enqueue a fresh finite organizer cycle.
-- A frequent `resume` call may only drain work that already exists, so the
-- resume job cannot accidentally turn into an endless re-enqueue loop.
--
-- The existing scheduler token is reused. It is generated/stored inside
-- Postgres and is never embedded in the cron definition as plaintext.

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
      body := '{}'::jsonb
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
      body := '{}'::jsonb
    );
  $cron$
);

-- Bootstrap the canonical model immediately when this migration reaches
-- production. The request is queued by pg_net and executes after commit; the
-- resume cron above then drains the rest of the organizer queue in short,
-- time-bounded invocations.
SELECT net.http_post(
  url := 'https://lanterna.dk/api/public/ebillet-sync',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-ebillet-mode', 'sync',
    'x-import-scheduler-token', (
      SELECT value FROM public.scheduler_secrets WHERE name = 'kultunaut_cron'
    )
  ),
  body := '{}'::jsonb
);
