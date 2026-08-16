-- Make source explicit at the database boundary for all non-eBillet writes.
-- This repairs the legacy Kultunaut importer, which did not always provide
-- showtimes.source on insert/update.
CREATE OR REPLACE FUNCTION public.normalize_showtime_metadata()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cinema_organizer integer;
  first_time text;
BEGIN
  SELECT ebillet_organizer_id
    INTO cinema_organizer
  FROM public.cinemas
  WHERE id = NEW.cinema_id;

  IF cinema_organizer IS NULL AND lower(coalesce(NEW.source, '')) = '' THEN
    NEW.source := 'kultunaut';
  END IF;

  -- Store the canonical UTC instant for the first listed screening time.
  -- `date`/`times` are the display/source-local values and remain unchanged.
  IF NEW.date IS NOT NULL
     AND NEW.times IS NOT NULL
     AND array_length(NEW.times, 1) > 0
     AND NEW.times[1] ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
    first_time := NEW.times[1];
    NEW.start_time := (
      (NEW.date::text || ' ' || first_time || ':00')::timestamp
      AT TIME ZONE 'Europe/Copenhagen'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_showtime_metadata ON public.showtimes;
CREATE TRIGGER trg_normalize_showtime_metadata
BEFORE INSERT OR UPDATE OF cinema_id, date, times, source ON public.showtimes
FOR EACH ROW
EXECUTE FUNCTION public.normalize_showtime_metadata();

-- Repair existing rows whose source was left blank by the legacy importer.
UPDATE public.showtimes s
SET source = 'kultunaut'
FROM public.cinemas c
WHERE c.id = s.cinema_id
  AND c.ebillet_organizer_id IS NULL
  AND lower(coalesce(s.source, '')) = '';

-- Repair start_time from the canonical Danish-local date/time representation.
UPDATE public.showtimes
SET start_time = (
  (date::text || ' ' || times[1] || ':00')::timestamp
  AT TIME ZONE 'Europe/Copenhagen'
)
WHERE date IS NOT NULL
  AND times IS NOT NULL
  AND array_length(times, 1) > 0
  AND times[1] ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$';
