-- Source authority: eBillet is authoritative for any cinema it owns.
-- Kultunaut must never create or modify showtimes for an eBillet-backed cinema.

CREATE OR REPLACE FUNCTION public.enforce_showtime_source_authority()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cinema_source text;
  cinema_organizer integer;
BEGIN
  SELECT source, ebillet_organizer_id
    INTO cinema_source, cinema_organizer
  FROM public.cinemas
  WHERE id = NEW.cinema_id;

  IF cinema_organizer IS NOT NULL
     AND lower(coalesce(NEW.source, '')) LIKE '%kultunaut%' THEN
    IF TG_OP = 'INSERT' THEN
      RETURN NULL;
    END IF;
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_showtimes_source_authority ON public.showtimes;
CREATE TRIGGER trg_showtimes_source_authority
BEFORE INSERT OR UPDATE ON public.showtimes
FOR EACH ROW
EXECUTE FUNCTION public.enforce_showtime_source_authority();

-- Never allow a Kultunaut write to downgrade a cinema that is already owned
-- by eBillet. Other metadata may still be refreshed by the importer.
CREATE OR REPLACE FUNCTION public.enforce_cinema_source_authority()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.ebillet_organizer_id IS NOT NULL
     AND lower(coalesce(NEW.source, '')) LIKE '%kultunaut%' THEN
    NEW.source := OLD.source;
    NEW.ebillet_organizer_id := OLD.ebillet_organizer_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cinemas_source_authority ON public.cinemas;
CREATE TRIGGER trg_cinemas_source_authority
BEFORE UPDATE ON public.cinemas
FOR EACH ROW
EXECUTE FUNCTION public.enforce_cinema_source_authority();
