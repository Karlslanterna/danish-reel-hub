-- eBillet is processed as a durable single-flight job. Prevent two concurrent
-- run drivers from creating competing cursors/runs.
CREATE UNIQUE INDEX IF NOT EXISTS ebillet_sync_runs_one_running_idx
  ON public.ebillet_sync_runs ((status))
  WHERE status = 'running';
