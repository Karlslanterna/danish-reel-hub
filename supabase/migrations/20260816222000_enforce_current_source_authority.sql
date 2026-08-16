-- Lanterna source-of-truth cleanup.
-- eBillet is authoritative for cinemas linked to an active eBillet organizer.
-- Kultunaut must never populate or mutate showtimes for those cinemas.

-- Backfill source for legacy rows where the source was omitted.
UPDATE public.showtimes s
SET source = CASE
  WHEN EXISTS (
    SELECT 1
    FROM public.ebillet_organizers eo
    WHERE eo.cinema_id = s.cinema_id
      AND eo.is_active = true
  ) THEN 'ebillet'
  ELSE 'kultunaut'
END
WHERE s.source IS NULL OR btrim(s.source) = '';

-- Remove legacy Kultunaut/unknown rows from eBillet-authoritative cinemas.
DELETE FROM public.showtimes s
WHERE EXISTS (
  SELECT 1
  FROM public.ebillet_organizers eo
  WHERE eo.cinema_id = s.cinema_id
    AND eo.is_active = true
)
AND COALESCE(s.source, '') <> 'ebillet';

-- Never allow a write to create a non-eBillet source on an eBillet cinema.
CREATE OR REPLACE FUNCTION public.enforce_ebillet_showtime_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.ebillet_organizers eo
    WHERE eo.cinema_id = NEW.cinema_id
      AND eo.is_active = true
  ) THEN
    NEW.source := 'ebillet';
  ELSIF NEW.source IS NULL OR btrim(NEW.source) = '' THEN
    NEW.source := 'kultunaut';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_ebillet_showtime_source ON public.showtimes;
CREATE TRIGGER trg_enforce_ebillet_showtime_source
BEFORE INSERT OR UPDATE OF cinema_id, source ON public.showtimes
FOR EACH ROW
EXECUTE FUNCTION public.enforce_ebillet_showtime_source();

-- Prevent a Kultunaut update from silently replacing the source of an
-- eBillet-authoritative row: the trigger above rewrites it to eBillet.
COMMENT ON FUNCTION public.enforce_ebillet_showtime_source() IS
  'Keeps showtime source authoritative: active eBillet cinema => ebillet; otherwise default to kultunaut.';
