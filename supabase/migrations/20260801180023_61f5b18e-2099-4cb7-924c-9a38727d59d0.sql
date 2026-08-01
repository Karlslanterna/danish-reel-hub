CREATE TABLE public.import_schedule_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'running',
  trigger text NOT NULL DEFAULT 'cron',
  job_id uuid,
  attempts integer NOT NULL DEFAULT 0,
  reason text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_seconds numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_schedule_runs_status_check CHECK (status IN ('running','completed','failed','skipped'))
);

GRANT SELECT ON public.import_schedule_runs TO authenticated;
GRANT ALL ON public.import_schedule_runs TO service_role;

ALTER TABLE public.import_schedule_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view scheduled import runs"
ON public.import_schedule_runs
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE UNIQUE INDEX import_schedule_runs_single_running
ON public.import_schedule_runs ((status))
WHERE status = 'running';

CREATE INDEX import_schedule_runs_started_at_idx
ON public.import_schedule_runs (started_at DESC);

CREATE TRIGGER set_import_schedule_runs_updated_at
BEFORE UPDATE ON public.import_schedule_runs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();