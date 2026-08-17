CREATE OR REPLACE FUNCTION public.enforce_showtime_source_authority()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  owned boolean;
BEGIN
  -- Ownership is the LINK between a cinema and an eBillet organizer, in either
  -- direction. `ebillet_organizers.is_active` is screening-availability status,
  -- NOT source authority, and must never widen/narrow write protection.
  SELECT EXISTS (
    SELECT 1 FROM public.cinemas c
    WHERE c.id = NEW.cinema_id AND c.ebillet_organizer_id IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM public.ebillet_organizers e
    WHERE e.cinema_id = NEW.cinema_id
  ) INTO owned;

  IF owned AND lower(coalesce(NEW.source, '')) LIKE '%kultunaut%' THEN
    RAISE EXCEPTION 'source authority: cinema % is owned by an eBillet organizer; showtimes with source % are not allowed',
      NEW.cinema_id, NEW.source
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.enforce_showtime_source_authority() IS
  'Source authority guard. Ownership = cinema<->ebillet_organizer link (any is_active status). Raises on illegal Kultunaut writes.';

COMMENT ON FUNCTION public.enforce_cinema_source_authority() IS
  'Rejects unlinking an eBillet organizer or downgrading an eBillet cinema to a Kultunaut source. Legitimate metadata updates stay allowed.';

COMMENT ON INDEX public.showtimes_identity_uidx IS
  'INTERIM constraint only. (movie_id, cinema_id, date, hall, source) does not identify a single screening because times[] still holds multiple screenings per row. It is a safety net against duplicate rows per source until the planned per-screening model (screenings table) replaces it; do not treat it as the canonical screening identity.';