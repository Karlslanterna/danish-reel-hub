-- Harden the canonical screening pipeline at the database boundary.
-- These checks are intentionally redundant with application code: import
-- correctness must not depend on every future importer remembering the rules.

-- ---------------------------------------------------------------------------
-- Locked source mappings are immutable unless deliberately unlocked first.
-- A race or a new importer must never silently re-point an established source
-- id to a different canonical entity.
CREATE OR REPLACE FUNCTION public.protect_locked_source_entity_ref()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.locked THEN
    IF NEW.source IS DISTINCT FROM OLD.source
       OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
       OR NEW.external_id IS DISTINCT FROM OLD.external_id
       OR NEW.canonical_id IS DISTINCT FROM OLD.canonical_id THEN
      RAISE EXCEPTION
        'identity mapping is locked: %/%/% -> %',
        OLD.source, OLD.entity_type, OLD.external_id, OLD.canonical_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS source_entity_refs_protect_locked ON public.source_entity_refs;
CREATE TRIGGER source_entity_refs_protect_locked
BEFORE UPDATE ON public.source_entity_refs
FOR EACH ROW
EXECUTE FUNCTION public.protect_locked_source_entity_ref();

COMMENT ON FUNCTION public.protect_locked_source_entity_ref() IS
  'Prevents a locked source identity from being silently re-pointed. Unlocking must be an explicit separate operation.';

-- ---------------------------------------------------------------------------
-- Atomic promotion, with hard scope and snapshot invariants.
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
  v_unstaged integer := 0;
  v_cross_scope integer := 0;
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
    RAISE EXCEPTION
      'promotion: snapshot % belongs to source %, not %',
      p_snapshot_id, v_snapshot_source, p_source
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_status NOT IN ('validated','promoted') THEN
    RAISE EXCEPTION
      'promotion: snapshot % has status % — only validated snapshots may promote',
      p_snapshot_id, v_status
      USING ERRCODE = 'check_violation';
  END IF;

  v_owner := public.cinema_authoritative_source(p_cinema_id);
  IF v_owner <> p_source THEN
    RAISE EXCEPTION
      'promotion: cinema % is owned by source %, % may not promote into it',
      p_cinema_id, v_owner, p_source
      USING ERRCODE = 'check_violation';
  END IF;

  -- Serialize concurrent promotions of exactly this source+cinema scope.
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
    SELECT source_ref
    FROM _desired
    GROUP BY source_ref
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'promotion: duplicate source_ref in desired snapshot scope'
      USING ERRCODE = 'unique_violation';
  END IF;

  -- Promotion may only use rows that passed through staging for this exact
  -- snapshot and source. This prevents callers from bypassing normalization /
  -- validation and submitting arbitrary canonical rows to the RPC.
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
    RAISE EXCEPTION
      'promotion: % desired rows were not staged by snapshot %',
      v_unstaged, p_snapshot_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- A stable source_ref can never migrate between cinemas. Without this guard,
  -- ON CONFLICT(source, source_ref) could move an existing screening into the
  -- target scope and thereby make one cinema promotion mutate another cinema.
  SELECT count(*) INTO v_cross_scope
  FROM _desired d
  JOIN public.screenings s
    ON s.source = p_source
   AND s.source_ref = d.source_ref
  WHERE s.cinema_id <> p_cinema_id;

  IF v_cross_scope > 0 THEN
    RAISE EXCEPTION
      'promotion: % source refs already belong to another cinema scope',
      v_cross_scope
      USING ERRCODE = 'check_violation';
  END IF;

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

  -- Destructive reconciliation is strictly confined to this one scope.
  DELETE FROM public.screenings s
  WHERE s.source = p_source
    AND s.cinema_id = p_cinema_id
    AND NOT EXISTS (
      SELECT 1 FROM _desired d WHERE d.source_ref = s.source_ref
    );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

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

COMMENT ON FUNCTION public.promote_screenings(uuid, text, text, jsonb) IS
  'Atomic promotion for one source+cinema. Requires a validated snapshot of the same source, staged rows only, and refuses cross-cinema source_ref moves.';
