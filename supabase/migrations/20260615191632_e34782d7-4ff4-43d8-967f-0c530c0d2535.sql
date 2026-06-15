
CREATE TABLE public.import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'kultunaut',
  status text NOT NULL DEFAULT 'queued',
  phase text NOT NULL DEFAULT 'pending',
  xml text NOT NULL,
  payload jsonb,
  cursor integer NOT NULL DEFAULT 0,
  total_movies integer NOT NULL DEFAULT 0,
  total_cinemas integer NOT NULL DEFAULT 0,
  total_showtimes integer NOT NULL DEFAULT 0,
  processed_movies integer NOT NULL DEFAULT 0,
  processed_cinemas integer NOT NULL DEFAULT 0,
  processed_showtimes integer NOT NULL DEFAULT 0,
  errors text[] NOT NULL DEFAULT '{}'::text[],
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.import_jobs TO service_role;

ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;

-- No public policies; access is service-role-only via the import endpoints.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER import_jobs_set_updated_at
BEFORE UPDATE ON public.import_jobs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
