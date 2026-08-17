-- ============================================================ identity layer
CREATE TABLE public.source_entity_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('cinema','movie')),
  external_id text NOT NULL,
  canonical_id text NOT NULL,
  match_method text NOT NULL,
  confidence numeric,
  locked boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, entity_type, external_id)
);
CREATE INDEX source_entity_refs_canonical_idx ON public.source_entity_refs (canonical_id, entity_type);
GRANT SELECT ON public.source_entity_refs TO authenticated;
GRANT ALL ON public.source_entity_refs TO service_role;
ALTER TABLE public.source_entity_refs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read source entity refs" ON public.source_entity_refs
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER source_entity_refs_set_updated_at BEFORE UPDATE ON public.source_entity_refs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Unresolved mappings awaiting admin review (never auto-created canonical rows).
CREATE TABLE public.unresolved_source_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('cinema','movie')),
  external_id text NOT NULL,
  label text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, entity_type, external_id)
);
GRANT SELECT ON public.unresolved_source_entities TO authenticated;
GRANT ALL ON public.unresolved_source_entities TO service_role;
ALTER TABLE public.unresolved_source_entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read unresolved entities" ON public.unresolved_source_entities
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER unresolved_source_entities_set_updated_at BEFORE UPDATE ON public.unresolved_source_entities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ================================================================ snapshots
CREATE TABLE public.import_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  scope_type text NOT NULL CHECK (scope_type IN ('feed','cinema','organizer')),
  scope_external_id text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  payload_hash text NOT NULL,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','validated','rejected','promoted','failed')),
  validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_payload text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX import_snapshots_scope_idx ON public.import_snapshots (source, scope_type, scope_external_id, fetched_at DESC);
GRANT SELECT ON public.import_snapshots TO authenticated;
GRANT ALL ON public.import_snapshots TO service_role;
ALTER TABLE public.import_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read import snapshots" ON public.import_snapshots
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER import_snapshots_set_updated_at BEFORE UPDATE ON public.import_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ================================================================== staging
CREATE TABLE public.staged_screenings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES public.import_snapshots(id) ON DELETE CASCADE,
  source text NOT NULL,
  source_ref text NOT NULL,
  source_cinema_ref text NOT NULL,
  source_movie_ref text NOT NULL,
  starts_at timestamptz NOT NULL,
  local_date date NOT NULL,
  local_time time NOT NULL,
  hall text NOT NULL DEFAULT '',
  ticket_url text,
  price_min numeric,
  price_max numeric,
  free_seats integer,
  formats text[] NOT NULL DEFAULT '{}',
  languages text[] NOT NULL DEFAULT '{}',
  events text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_id, source_ref)
);
CREATE INDEX staged_screenings_snapshot_idx ON public.staged_screenings (snapshot_id);
CREATE INDEX staged_screenings_scope_idx ON public.staged_screenings (source, source_cinema_ref, starts_at);
GRANT SELECT ON public.staged_screenings TO authenticated;
GRANT ALL ON public.staged_screenings TO service_role;
ALTER TABLE public.staged_screenings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read staged screenings" ON public.staged_screenings
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));

-- ============================================== canonical screenings table
CREATE TABLE public.screenings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  source_ref text NOT NULL,
  cinema_id text NOT NULL REFERENCES public.cinemas(id) ON DELETE RESTRICT,
  movie_id text NOT NULL REFERENCES public.movies(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL,
  local_date date NOT NULL,
  local_time time NOT NULL,
  hall text NOT NULL DEFAULT '',
  ticket_url text,
  price_min numeric,
  price_max numeric,
  free_seats integer,
  formats text[] NOT NULL DEFAULT '{}',
  languages text[] NOT NULL DEFAULT '{}',
  events text[] NOT NULL DEFAULT '{}',
  snapshot_id uuid REFERENCES public.import_snapshots(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT screenings_source_ref_key UNIQUE (source, source_ref),
  CONSTRAINT screenings_identity_key UNIQUE (source, cinema_id, movie_id, starts_at, hall)
);
CREATE INDEX screenings_cinema_starts_idx ON public.screenings (cinema_id, starts_at);
CREATE INDEX screenings_movie_starts_idx ON public.screenings (movie_id, starts_at);
CREATE INDEX screenings_starts_idx ON public.screenings (starts_at);
CREATE INDEX screenings_source_cinema_starts_idx ON public.screenings (source, cinema_id, starts_at);
CREATE INDEX screenings_local_date_idx ON public.screenings (local_date);
GRANT SELECT ON public.screenings TO anon, authenticated;
GRANT ALL ON public.screenings TO service_role;
ALTER TABLE public.screenings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read screenings" ON public.screenings
  FOR SELECT TO anon, authenticated USING (private.cinema_is_public(cinema_id));
CREATE TRIGGER screenings_set_updated_at BEFORE UPDATE ON public.screenings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.screenings IS
  'Canonical screening model: exactly one row per physical screening. local_date/local_time are derived from starts_at in Europe/Copenhagen for display and filtering. public.showtimes is only a compatibility read model during the migration.';

-- Derive the local parts; a generated column cannot be used because the
-- timezone conversion is STABLE, not IMMUTABLE.
CREATE OR REPLACE FUNCTION public.set_screening_local_parts()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.local_date := (NEW.starts_at AT TIME ZONE 'Europe/Copenhagen')::date;
  NEW.local_time := (NEW.starts_at AT TIME ZONE 'Europe/Copenhagen')::time;
  RETURN NEW;
END;
$$;
CREATE TRIGGER screenings_local_parts BEFORE INSERT OR UPDATE ON public.screenings
  FOR EACH ROW EXECUTE FUNCTION public.set_screening_local_parts();

-- ============================================ source authority for cinemas
CREATE OR REPLACE FUNCTION public.cinema_authoritative_source(p_cinema_id text)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.cinemas c
      WHERE c.id = p_cinema_id AND c.ebillet_organizer_id IS NOT NULL
    ) OR EXISTS (
      SELECT 1 FROM public.ebillet_organizers e WHERE e.cinema_id = p_cinema_id
    ) THEN 'ebillet'
    ELSE 'kultunaut'
  END;
$$;
COMMENT ON FUNCTION public.cinema_authoritative_source(text) IS
  'Ownership follows the cinema<->ebillet_organizer link only. is_active is availability, never authority.';

CREATE OR REPLACE FUNCTION public.enforce_screening_source_authority()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE owner text;
BEGIN
  owner := public.cinema_authoritative_source(NEW.cinema_id);
  IF owner <> NEW.source THEN
    RAISE EXCEPTION 'source authority: cinema % is owned by source %, screening source % is not allowed',
      NEW.cinema_id, owner, NEW.source USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER screenings_source_authority BEFORE INSERT OR UPDATE ON public.screenings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_screening_source_authority();

-- ================================================================ job model
CREATE TABLE public.import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  scope_type text NOT NULL,
  scope_key text NOT NULL,
  snapshot_id uuid REFERENCES public.import_snapshots(id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued','running','paused','completed','failed','dead_letter')),
  cursor jsonb,
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  last_heartbeat timestamptz,
  last_error text,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE UNIQUE INDEX import_runs_single_active_idx
  ON public.import_runs (source, scope_type, scope_key)
  WHERE state IN ('queued','running');
CREATE INDEX import_runs_state_idx ON public.import_runs (state, lease_until);
GRANT SELECT ON public.import_runs TO authenticated;
GRANT ALL ON public.import_runs TO service_role;
ALTER TABLE public.import_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read import runs" ON public.import_runs
  FOR SELECT TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER import_runs_set_updated_at BEFORE UPDATE ON public.import_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Claim the next runnable job. A crashed worker's lease expires and the row
-- becomes claimable again; nothing else may touch a live lease.
CREATE OR REPLACE FUNCTION public.claim_import_run(p_source text, p_lease_seconds integer DEFAULT 120)
RETURNS SETOF public.import_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id
  FROM public.import_runs
  WHERE source = p_source
    AND state IN ('queued','running')
    AND (lease_until IS NULL OR lease_until < now())
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  UPDATE public.import_runs
  SET state = 'running',
      attempts = attempts + 1,
      lease_until = now() + make_interval(secs => p_lease_seconds),
      last_heartbeat = now()
  WHERE id = v_id
  RETURNING *;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_import_run(text, integer) FROM public, anon, authenticated;

-- ====================================================== atomic promotion RPC
CREATE OR REPLACE FUNCTION public.promote_screenings(
  p_snapshot_id uuid,
  p_source text,
  p_cinema_id text,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_status text;
  v_owner text;
  v_upserted integer := 0;
  v_deleted integer := 0;
BEGIN
  SELECT status INTO v_status FROM public.import_snapshots WHERE id = p_snapshot_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'promotion: unknown snapshot %', p_snapshot_id USING ERRCODE = 'check_violation';
  END IF;
  IF v_status NOT IN ('validated','promoted') THEN
    RAISE EXCEPTION 'promotion: snapshot % has status % — only validated snapshots may promote', p_snapshot_id, v_status
      USING ERRCODE = 'check_violation';
  END IF;

  v_owner := public.cinema_authoritative_source(p_cinema_id);
  IF v_owner <> p_source THEN
    RAISE EXCEPTION 'promotion: cinema % is owned by source %, % may not promote into it', p_cinema_id, v_owner, p_source
      USING ERRCODE = 'check_violation';
  END IF;

  -- Serialise concurrent promotions of the same scope.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_source || ':' || p_cinema_id, 0));

  CREATE TEMP TABLE _desired ON COMMIT DROP AS
  SELECT * FROM jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) AS x(
    source_ref text, movie_id text, starts_at timestamptz, hall text,
    ticket_url text, price_min numeric, price_max numeric, free_seats integer,
    formats text[], languages text[], events text[]
  );

  INSERT INTO public.screenings AS s (
    source, source_ref, cinema_id, movie_id, starts_at, local_date, local_time, hall,
    ticket_url, price_min, price_max, free_seats, formats, languages, events, snapshot_id
  )
  SELECT p_source, d.source_ref, p_cinema_id, d.movie_id, d.starts_at,
         (d.starts_at AT TIME ZONE 'Europe/Copenhagen')::date,
         (d.starts_at AT TIME ZONE 'Europe/Copenhagen')::time,
         coalesce(d.hall, ''), d.ticket_url, d.price_min, d.price_max, d.free_seats,
         coalesce(d.formats, '{}'), coalesce(d.languages, '{}'), coalesce(d.events, '{}'),
         p_snapshot_id
  FROM _desired d
  ON CONFLICT (source, source_ref) DO UPDATE SET
    cinema_id = EXCLUDED.cinema_id,
    movie_id = EXCLUDED.movie_id,
    starts_at = EXCLUDED.starts_at,
    hall = EXCLUDED.hall,
    ticket_url = EXCLUDED.ticket_url,
    price_min = EXCLUDED.price_min,
    price_max = EXCLUDED.price_max,
    free_seats = EXCLUDED.free_seats,
    formats = EXCLUDED.formats,
    languages = EXCLUDED.languages,
    events = EXCLUDED.events,
    snapshot_id = EXCLUDED.snapshot_id;
  GET DIAGNOSTICS v_upserted = ROW_COUNT;

  -- Stale removals are strictly scoped to this source + cinema.
  DELETE FROM public.screenings s
  WHERE s.source = p_source
    AND s.cinema_id = p_cinema_id
    AND NOT EXISTS (SELECT 1 FROM _desired d WHERE d.source_ref = s.source_ref);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  UPDATE public.import_snapshots SET status = 'promoted' WHERE id = p_snapshot_id;

  RETURN jsonb_build_object('upserted', v_upserted, 'deleted', v_deleted, 'cinema_id', p_cinema_id, 'source', p_source);
END;
$$;
REVOKE ALL ON FUNCTION public.promote_screenings(uuid, text, text, jsonb) FROM public, anon, authenticated;

-- ================== compatibility write model: rebuild showtimes from screenings
CREATE OR REPLACE FUNCTION public.rebuild_showtimes_for_cinema(p_source text, p_cinema_id text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_rows integer := 0;
BEGIN
  DELETE FROM public.showtimes WHERE cinema_id = p_cinema_id AND source = p_source;

  INSERT INTO public.showtimes (
    movie_id, cinema_id, date, hall, times, ticket_url, ticket_urls, booking_url,
    start_time, formats, languages, events, source, min_price, max_price, free_seats
  )
  SELECT g.movie_id, g.cinema_id, to_char(g.local_date, 'YYYY-MM-DD'), g.hall,
         g.times, g.ticket_urls[1], g.ticket_urls, g.ticket_urls[1], g.start_time,
         g.formats, g.languages, g.events, p_source, g.min_price, g.max_price, g.free_seats
  FROM (
    SELECT s.movie_id, s.cinema_id, s.local_date, s.hall,
           array_agg(to_char(s.local_time, 'HH24:MI') ORDER BY s.starts_at) AS times,
           array_agg(coalesce(s.ticket_url, '') ORDER BY s.starts_at) AS ticket_urls,
           min(s.starts_at) AS start_time,
           (array_agg(s.formats ORDER BY s.starts_at))[1] AS formats,
           (array_agg(s.languages ORDER BY s.starts_at))[1] AS languages,
           (array_agg(s.events ORDER BY s.starts_at))[1] AS events,
           min(s.price_min) AS min_price,
           max(s.price_max) AS max_price,
           sum(s.free_seats) AS free_seats
    FROM public.screenings s
    WHERE s.cinema_id = p_cinema_id AND s.source = p_source
    GROUP BY s.movie_id, s.cinema_id, s.local_date, s.hall
  ) g
  ON CONFLICT (movie_id, cinema_id, date, hall, source) DO UPDATE SET
    times = EXCLUDED.times, ticket_urls = EXCLUDED.ticket_urls,
    ticket_url = EXCLUDED.ticket_url, booking_url = EXCLUDED.booking_url,
    start_time = EXCLUDED.start_time, formats = EXCLUDED.formats,
    languages = EXCLUDED.languages, events = EXCLUDED.events,
    min_price = EXCLUDED.min_price, max_price = EXCLUDED.max_price,
    free_seats = EXCLUDED.free_seats;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;
REVOKE ALL ON FUNCTION public.rebuild_showtimes_for_cinema(text, text) FROM public, anon, authenticated;
COMMENT ON FUNCTION public.rebuild_showtimes_for_cinema(text, text) IS
  'Compatibility only: refreshes the legacy showtimes read model from canonical screenings for one source+cinema scope. Remove once the frontend reads screenings exclusively.';