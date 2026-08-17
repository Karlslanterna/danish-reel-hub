-- Operational housekeeping for the canonical import pipeline.
-- No canonical cinema/movie/screening rows are deleted by this function.

CREATE OR REPLACE FUNCTION public.cleanup_import_audit_data(
  p_raw_payload_days integer DEFAULT 21,
  p_staging_days integer DEFAULT 30,
  p_snapshot_metadata_days integer DEFAULT 90
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_raw_cleared integer := 0;
  v_staging_deleted integer := 0;
  v_snapshots_deleted integer := 0;
BEGIN
  IF p_raw_payload_days < 1 OR p_staging_days < 1 OR p_snapshot_metadata_days < 1 THEN
    RAISE EXCEPTION 'retention days must all be >= 1'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Large raw feeds are useful briefly for diagnosis, but should not grow
  -- indefinitely. Keep the snapshot record/hash/validation after clearing raw.
  UPDATE public.import_snapshots
  SET raw_payload = NULL
  WHERE raw_payload IS NOT NULL
    AND fetched_at < now() - make_interval(days => p_raw_payload_days);
  GET DIAGNOSTICS v_raw_cleared = ROW_COUNT;

  -- Staged rows are an audit/resume buffer, not the canonical product model.
  DELETE FROM public.staged_screenings ss
  USING public.import_snapshots s
  WHERE ss.snapshot_id = s.id
    AND s.status IN ('promoted','rejected','failed')
    AND s.fetched_at < now() - make_interval(days => p_staging_days);
  GET DIAGNOSTICS v_staging_deleted = ROW_COUNT;

  -- Old snapshot metadata may be removed only after its staging is gone.
  -- screenings.snapshot_id uses ON DELETE SET NULL, so canonical screenings
  -- remain intact and retain their own source/source_ref identity.
  DELETE FROM public.import_snapshots s
  WHERE s.status IN ('promoted','rejected','failed')
    AND s.fetched_at < now() - make_interval(days => p_snapshot_metadata_days)
    AND NOT EXISTS (
      SELECT 1 FROM public.staged_screenings ss WHERE ss.snapshot_id = s.id
    );
  GET DIAGNOSTICS v_snapshots_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'raw_payloads_cleared', v_raw_cleared,
    'staged_rows_deleted', v_staging_deleted,
    'snapshots_deleted', v_snapshots_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_import_audit_data(integer, integer, integer)
  FROM public, anon, authenticated;

COMMENT ON FUNCTION public.cleanup_import_audit_data(integer, integer, integer) IS
  'Retention only for import audit/staging data. Never deletes canonical screenings, movies or cinemas.';

-- During the transition we deliberately keep the legacy grouped `showtimes`
-- table synchronized. This view makes the two models measurable before writes
-- to the compatibility table are switched off.
CREATE OR REPLACE VIEW public.screening_model_parity
WITH (security_invoker = true)
AS
WITH canonical AS (
  SELECT
    source,
    cinema_id,
    local_date AS screening_date,
    count(*)::bigint AS physical_screenings
  FROM public.screenings
  GROUP BY source, cinema_id, local_date
),
legacy AS (
  SELECT
    source,
    cinema_id,
    date::date AS screening_date,
    sum(GREATEST(COALESCE(array_length(times, 1), 0), 1))::bigint AS physical_screenings
  FROM public.showtimes
  WHERE date ~ '^\d{4}-\d{2}-\d{2}$'
  GROUP BY source, cinema_id, date::date
)
SELECT
  COALESCE(c.source, l.source) AS source,
  COALESCE(c.cinema_id, l.cinema_id) AS cinema_id,
  COALESCE(c.screening_date, l.screening_date) AS screening_date,
  COALESCE(c.physical_screenings, 0) AS canonical_count,
  COALESCE(l.physical_screenings, 0) AS legacy_count,
  COALESCE(c.physical_screenings, 0) - COALESCE(l.physical_screenings, 0) AS delta
FROM canonical c
FULL OUTER JOIN legacy l
  ON l.source = c.source
 AND l.cinema_id = c.cinema_id
 AND l.screening_date = c.screening_date;

GRANT SELECT ON public.screening_model_parity TO authenticated;

COMMENT ON VIEW public.screening_model_parity IS
  'Temporary transition audit: canonical one-row-per-screening counts versus grouped legacy showtimes counts. Remove after compatibility writes are retired.';
