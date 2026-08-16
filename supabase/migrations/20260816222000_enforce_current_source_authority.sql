-- Lanterna source-of-truth cleanup.
-- eBillet is authoritative for cinemas linked to an active eBillet organizer.
-- Kultunaut must never populate or mutate showtimes for those cinemas.

UPDATE public.showtimes s
SET source = CASE
  WHEN EXISTS (
    SELECT 1 FROM public.ebillet_organizers eo
    WHERE eo.cinema_id = s.cinema_id AND eo.is_active = true
  ) THEN 'ebillet'
  ELSE 'kultunaut'
END
WHERE s.source IS NULL OR btrim(s.source) = '';

DELETE FROM public.showtimes s
WHERE EXISTS (
  SELECT 1 FROM public.ebillet_organizers eo
  WHERE eo.cinema_id = s.cinema_id AND eo.is_active = true
)
AND COALESCE(s.source, '') <> 'ebillet';

CREATE OR REPLACE FUNCTION public.enforce_ebillet_showtime_source()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.ebillet_organizers eo
    WHERE eo.cinema_id = NEW.cinema_id AND eo.is_active = true
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
FOR EACH ROW EXECUTE FUNCTION public.enforce_ebillet_showtime_source();

-- When a cinema becomes eBillet-covered later, purge any old Kultunaut rows
-- immediately instead of waiting for the next import.
CREATE OR REPLACE FUNCTION public.enforce_ebillet_cinema_coverage()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_active = true AND NEW.cinema_id IS NOT NULL THEN
    DELETE FROM public.showtimes
    WHERE cinema_id = NEW.cinema_id
      AND COALESCE(source, '') <> 'ebillet';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_ebillet_cinema_coverage ON public.ebillet_organizers;
CREATE TRIGGER trg_enforce_ebillet_cinema_coverage
AFTER INSERT OR UPDATE OF cinema_id, is_active ON public.ebillet_organizers
FOR EACH ROW EXECUTE FUNCTION public.enforce_ebillet_cinema_coverage();

COMMENT ON FUNCTION public.enforce_ebillet_showtime_source() IS
  'Keeps showtime source authoritative: active eBillet cinema => ebillet; otherwise default to kultunaut.';
COMMENT ON FUNCTION public.enforce_ebillet_cinema_coverage() IS
  'Removes legacy non-eBillet showtimes when an organizer becomes active for a cinema.';
