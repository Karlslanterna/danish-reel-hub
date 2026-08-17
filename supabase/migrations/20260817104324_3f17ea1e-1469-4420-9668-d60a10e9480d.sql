-- ============================================================================
-- Phase 1: cross-source safety layer for the import pipeline.
-- Audit report (read-only, run before this migration):
--   select s.source, count(*) from showtimes s
--     join ebillet_organizers e on e.cinema_id = s.cinema_id and e.is_active
--    group by 1;
--   => kultunaut: 199, ebillet: 6764
--   select count(*) from (select movie_id,cinema_id,date,hall,source,count(*)
--     from showtimes group by 1,2,3,4,5 having count(*)>1) t;  => 0 conflicts
-- ============================================================================

-- 1. Remove Kultunaut showtimes on eBillet-owned cinemas (199 rows).
--    eBillet is authoritative for these venues; these rows are duplicates of
--    (or conflicts with) the eBillet snapshot. Nothing else is deleted.
DELETE FROM public.showtimes s
USING public.ebillet_organizers e
WHERE e.cinema_id = s.cinema_id
  AND e.is_active
  AND lower(coalesce(s.source, '')) LIKE '%kultunaut%';

-- 2. Showtime identity within the current (grouped times[]) model.
--    Source is part of the key: the two feeds may legitimately describe the
--    same slot while a cinema is being migrated between sources.
CREATE UNIQUE INDEX IF NOT EXISTS showtimes_identity_uidx
  ON public.showtimes (movie_id, cinema_id, date, hall, source);

CREATE INDEX IF NOT EXISTS showtimes_cinema_date_idx
  ON public.showtimes (cinema_id, date);

CREATE INDEX IF NOT EXISTS showtimes_source_date_idx
  ON public.showtimes (source, date);

-- 3. Source authority triggers must fail loudly instead of silently
--    swallowing the write.
CREATE OR REPLACE FUNCTION public.enforce_cinema_source_authority()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Legitimate metadata updates on an eBillet cinema stay allowed; only a
  -- source downgrade or unlinking of the organizer is rejected.
  IF OLD.ebillet_organizer_id IS NOT NULL THEN
    IF NEW.ebillet_organizer_id IS DISTINCT FROM OLD.ebillet_organizer_id
       AND NEW.ebillet_organizer_id IS NULL THEN
      RAISE EXCEPTION 'source authority: cinema % is owned by eBillet organizer % and cannot be unlinked by this write',
        OLD.id, OLD.ebillet_organizer_id
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.source IS DISTINCT FROM OLD.source
       AND lower(coalesce(NEW.source, '')) LIKE '%kultunaut%' THEN
      RAISE EXCEPTION 'source authority: cinema % is owned by eBillet and cannot be downgraded to source %',
        OLD.id, NEW.source
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_showtime_source_authority()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  owned boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.ebillet_organizers e
    WHERE e.cinema_id = NEW.cinema_id
      AND e.is_active
  ) INTO owned;

  IF owned AND lower(coalesce(NEW.source, '')) LIKE '%kultunaut%' THEN
    RAISE EXCEPTION 'source authority: cinema % is owned by an active eBillet organizer; showtimes with source % are not allowed',
      NEW.cinema_id, NEW.source
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;