CREATE TABLE public.scheduler_secrets (
  name text PRIMARY KEY,
  value text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.scheduler_secrets TO service_role;

ALTER TABLE public.scheduler_secrets ENABLE ROW LEVEL SECURITY;

-- Intentionally no policies: only service_role (which bypasses RLS) may read
-- this table. anon/authenticated have no grants and no policies.

CREATE TRIGGER set_scheduler_secrets_updated_at
BEFORE UPDATE ON public.scheduler_secrets
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.scheduler_secrets (name) VALUES ('kultunaut_cron')
ON CONFLICT (name) DO NOTHING;