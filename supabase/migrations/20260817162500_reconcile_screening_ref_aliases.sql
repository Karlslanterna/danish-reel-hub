-- A source booking/showtime id may change while the underlying physical
-- screening stays the same. eBillet also occasionally exposes more than one
-- booking id for one movie/hall/start slot. Canonical identity is physical;
-- source_ref is an upstream handle and must be allowed to rotate safely.
--
-- Before upsert, remove an existing same-scope row that occupies a desired
-- physical identity under a different source_ref. The whole function runs in
-- one transaction, so any later failure restores the previous production rows.

CREATE OR REPLACE FUNCTION public.promote_screenings(
  p_snapshot_id uuid,
  p_source text,
  p_cinema_id text,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status text;
  v_snapshot_source text;
  v_owner text;
  v_upserted integer := 0;
  v_deleted integer := 0;
  v_alias_deleted integer := 0;
  v_unstaged integer := 0;
  v_cross_scope integer := 0;
  v_duplicate_identity integer := 0;
BEGIN
  SELECT status, source
    INTO v_status, v_snapshot_source
  FROM public.import_snapshots
  WHERE id = p_snapshot_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'promotion: unknown snapshot %', p_snapshot_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_snapshot_source IS DISTINCT FROM p_source THEN
    RAISE EXCEPTION 'promotion: snapshot % belongs to source %, not %',
      p_snapshot_id, v_snapshot_source, p_source
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_status NOT IN ('validated','promoted') THEN
    RAISE EXCEPTION 'promotion: snapshot % has status % — only validated snapshots may promote',
      p_snapshot_id, v_status
      USING ERRCODE = 'check_violation';
  END IF;

  v_owner := public.cinema_authoritative_source(p_cinema_id);
  IF v_owner <> p_source THEN
    RAISE EXCEPTION 'promotion: cinema % is owned by source %, % may not promote into it',
      p_cinema_id, v_owner, p_source
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_source || ':' || p_cinema_id, 0));

  CREATE TEMP TABLE _desired ON COMMIT DROP AS
  SELECT *
  FROM jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) AS x(
    source_ref text,
    movie_id text,
    starts_at timestamptz,
    hall text,
    ticket_url text,
    price_min numeric,
    price_max numeric,
    free_seats integer,
    formats text[],
    languages text[],
    events text[]
  );

  IF EXISTS (
    SELECT 1 FROM _desired
    WHERE source_ref IS NULL OR source_ref = ''
       OR movie_id IS NULL OR movie_id = ''
       OR starts_at IS NULL
  ) THEN
    RAISE EXCEPTION 'promotion: desired rows contain missing identity fields'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT source_ref FROM _desired GROUP BY source_ref HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'promotion: duplicate source_ref in desired snapshot scope'
      USING ERRCODE = 'unique_violation';
  END IF;

  SELECT count(*) INTO v_duplicate_identity
  FROM (
    SELECT movie_id, starts_at, coalesce(hall, '') AS hall
    FROM _desired
    GROUP BY movie_id, starts_at, coalesce(hall, '')
    HAVING count(*) > 1
  ) dups;

  IF v_duplicate_identity > 0 THEN
    RAISE EXCEPTION 'promotion: % duplicate physical screening identities in desired snapshot scope',
      v_duplicate_identity
      USING ERRCODE = 'unique_violation';
  END IF;

  SELECT count(*) INTO v_unstaged
  FROM _desired d
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.staged_screenings ss
    WHERE ss.snapshot_id = p_snapshot_id
      AND ss.source = p_source
      AND ss.source_ref = d.source_ref
  );

  IF v_unstaged > 0 THEN
    RAISE EXCEPTION 'promotion: % desired rows were not staged by snapshot %',
      v_unstaged, p_snapshot_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_cross_scope
  FROM _desired d
  JOIN public.screenings s
    ON s.source = p_source
   AND s.source_ref = d.source_ref
  WHERE s.cinema_id <> p_cinema_id;

  IF v_cross_scope > 0 THEN
    RAISE EXCEPTION 'promotion: % source refs already belong to another cinema scope',
      v_cross_scope
      USING ERRCODE = 'check_violation';
  END IF;

  -- Free a desired physical identity when an older upstream ref currently
  -- occupies it. This is the safe transition path for booking-id churn and
  -- historical synthetic refs.
  DELETE FROM public.screenings s
  WHERE s.source = p_source
    AND s.cinema_id = p_cinema_id
    AND EXISTS (
      SELECT 1
      FROM _desired d
      WHERE d.movie_id = s.movie_id
        AND d.starts_at = s.starts_at
        AND coalesce(d.hall, '') = s.hall
        AND d.source_ref <> s.source_ref
    );
  GET DIAGNOSTICS v_alias_deleted = ROW_COUNT;

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

  DELETE FROM public.screenings s
  WHERE s.source = p_source
    AND s.cinema_id = p_cinema_id
    AND NOT EXISTS (
      SELECT 1 FROM _desired d WHERE d.source_ref = s.source_ref
    );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  v_deleted := v_deleted + v_alias_deleted;

  UPDATE public.import_snapshots
  SET status = 'promoted'
  WHERE id = p_snapshot_id;

  RETURN jsonb_build_object(
    'upserted', v_upserted,
    'deleted', v_deleted,
    'cinema_id', p_cinema_id,
    'source', p_source
  );
END;
$$;

REVOKE ALL ON FUNCTION public.promote_screenings(uuid, text, text, jsonb)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_screenings(uuid, text, text, jsonb)
  TO service_role;

COMMENT ON FUNCTION public.promote_screenings(uuid, text, text, jsonb) IS
  'Atomic source+cinema promotion. Validates staged identity, rejects duplicate physical rows, and safely replaces obsolete upstream refs for the same physical screening.';
