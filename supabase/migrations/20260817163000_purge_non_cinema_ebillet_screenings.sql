-- Organizers classified as non-cinemas must not retain product screenings.
-- They are already hidden from public reads, but stale canonical/legacy rows
-- distort parity and can reappear if visibility rules change later.

CREATE OR REPLACE FUNCTION public.purge_ebillet_non_cinema_scope(
  p_organizer_id integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cinema_id text;
  v_status text;
  v_error text;
  v_canonical_deleted integer := 0;
  v_legacy_deleted integer := 0;
BEGIN
  SELECT cinema_id, last_sync_status, last_sync_error
    INTO v_cinema_id, v_status, v_error
  FROM public.ebillet_organizers
  WHERE id = p_organizer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'non-cinema purge: unknown eBillet organizer %', p_organizer_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_status IS DISTINCT FROM 'skipped'
     OR coalesce(v_error, '') NOT LIKE 'Ikke-biograf%' THEN
    RAISE EXCEPTION 'non-cinema purge: organizer % is not explicitly classified as non-cinema', p_organizer_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_cinema_id IS NULL THEN
    SELECT id INTO v_cinema_id
    FROM public.cinemas
    WHERE ebillet_organizer_id = p_organizer_id
    LIMIT 1;
  END IF;

  IF v_cinema_id IS NULL THEN
    RETURN jsonb_build_object(
      'organizer_id', p_organizer_id,
      'cinema_id', NULL,
      'canonical_deleted', 0,
      'legacy_deleted', 0
    );
  END IF;

  DELETE FROM public.screenings
  WHERE source = 'ebillet'
    AND cinema_id = v_cinema_id;
  GET DIAGNOSTICS v_canonical_deleted = ROW_COUNT;

  DELETE FROM public.showtimes
  WHERE source = 'ebillet'
    AND cinema_id = v_cinema_id;
  GET DIAGNOSTICS v_legacy_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'organizer_id', p_organizer_id,
    'cinema_id', v_cinema_id,
    'canonical_deleted', v_canonical_deleted,
    'legacy_deleted', v_legacy_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_ebillet_non_cinema_scope(integer)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_ebillet_non_cinema_scope(integer)
  TO service_role;

COMMENT ON FUNCTION public.purge_ebillet_non_cinema_scope(integer) IS
  'Atomically removes eBillet canonical and compatibility screening rows only for organizers already marked skipped with an explicit Ikke-biograf classification.';

-- Clean historical rows that predate the canonical venue filter.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id
    FROM public.ebillet_organizers
    WHERE last_sync_status = 'skipped'
      AND coalesce(last_sync_error, '') LIKE 'Ikke-biograf%'
  LOOP
    PERFORM public.purge_ebillet_non_cinema_scope(r.id);
  END LOOP;
END $$;
