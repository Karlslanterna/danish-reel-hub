-- 1. Source tagging + eBillet identifiers on existing tables
ALTER TABLE public.cinemas
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'kultunaut',
  ADD COLUMN IF NOT EXISTS ebillet_organizer_id integer;
CREATE UNIQUE INDEX IF NOT EXISTS cinemas_ebillet_organizer_id_key
  ON public.cinemas (ebillet_organizer_id) WHERE ebillet_organizer_id IS NOT NULL;

ALTER TABLE public.movies
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'kultunaut',
  ADD COLUMN IF NOT EXISTS ebillet_movie_base_id integer,
  ADD COLUMN IF NOT EXISTS ebillet_movie_ids integer[] NOT NULL DEFAULT '{}'::integer[];
CREATE INDEX IF NOT EXISTS movies_ebillet_movie_base_id_idx
  ON public.movies (ebillet_movie_base_id) WHERE ebillet_movie_base_id IS NOT NULL;

ALTER TABLE public.showtimes
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'kultunaut',
  ADD COLUMN IF NOT EXISTS ebillet_showtime_ids integer[] NOT NULL DEFAULT '{}'::integer[],
  ADD COLUMN IF NOT EXISTS min_price numeric,
  ADD COLUMN IF NOT EXISTS max_price numeric,
  ADD COLUMN IF NOT EXISTS free_seats integer;
CREATE INDEX IF NOT EXISTS showtimes_source_idx ON public.showtimes (source);

-- 2. eBillet organizer register (discovery output)
CREATE TABLE IF NOT EXISTS public.ebillet_organizers (
  id integer PRIMARY KEY,
  name text NOT NULL,
  city text,
  address text,
  region text,
  zip text,
  location_count integer NOT NULL DEFAULT 0,
  showtime_count integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT false,
  cinema_id text REFERENCES public.cinemas(id) ON DELETE SET NULL,
  last_synced_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  last_sync_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ebillet_organizers TO authenticated;
GRANT ALL ON public.ebillet_organizers TO service_role;
ALTER TABLE public.ebillet_organizers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read ebillet organizers"
  ON public.ebillet_organizers FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER ebillet_organizers_set_updated_at
  BEFORE UPDATE ON public.ebillet_organizers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. eBillet sync run log
CREATE TABLE IF NOT EXISTS public.ebillet_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL DEFAULT 'sync',
  status text NOT NULL DEFAULT 'running',
  trigger text NOT NULL DEFAULT 'manual',
  cursor integer NOT NULL DEFAULT 0,
  organizers_found integer NOT NULL DEFAULT 0,
  organizers_active integer NOT NULL DEFAULT 0,
  organizers_synced integer NOT NULL DEFAULT 0,
  organizers_failed integer NOT NULL DEFAULT 0,
  cinemas_upserted integer NOT NULL DEFAULT 0,
  movies_upserted integer NOT NULL DEFAULT 0,
  showtimes_upserted integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_seconds numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ebillet_sync_runs TO authenticated;
GRANT ALL ON public.ebillet_sync_runs TO service_role;
ALTER TABLE public.ebillet_sync_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read ebillet sync runs"
  ON public.ebillet_sync_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER ebillet_sync_runs_set_updated_at
  BEFORE UPDATE ON public.ebillet_sync_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS ebillet_sync_runs_started_at_idx
  ON public.ebillet_sync_runs (started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ebillet_sync_runs_single_running
  ON public.ebillet_sync_runs (status) WHERE status = 'running';