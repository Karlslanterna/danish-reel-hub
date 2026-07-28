CREATE TABLE public.import_health_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('healthy','warning','critical','unknown')),
  previous_status TEXT,
  reasons TEXT[] NOT NULL DEFAULT '{}',
  job_id UUID,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_import_health_events_created_at ON public.import_health_events (created_at DESC);

GRANT SELECT ON public.import_health_events TO authenticated;
GRANT ALL ON public.import_health_events TO service_role;

ALTER TABLE public.import_health_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read health events"
  ON public.import_health_events
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));