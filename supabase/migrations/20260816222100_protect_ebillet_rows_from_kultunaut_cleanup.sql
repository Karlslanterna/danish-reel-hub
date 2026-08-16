-- Generic cleanup is allowed to remove Kultunaut data, but must never
-- delete eBillet-owned entities as a side effect.

CREATE OR REPLACE FUNCTION public.protect_ebillet_showtime_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(OLD.source, '') = 'ebillet'
     OR COALESCE(array_length(OLD.ebillet_showtime_ids, 1), 0) > 0 THEN
    RETURN NULL;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_ebillet_showtime_delete ON public.showtimes;
CREATE TRIGGER trg_protect_ebillet_showtime_delete
BEFORE DELETE ON public.showtimes
FOR EACH ROW
EXECUTE FUNCTION public.protect_ebillet_showtime_delete();

CREATE OR REPLACE FUNCTION public.protect_ebillet_movie_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.ebillet_movie_base_id IS NOT NULL
     OR COALESCE(array_length(OLD.ebillet_movie_ids, 1), 0) > 0 THEN
    RETURN NULL;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_ebillet_movie_delete ON public.movies;
CREATE TRIGGER trg_protect_ebillet_movie_delete
BEFORE DELETE ON public.movies
FOR EACH ROW
EXECUTE FUNCTION public.protect_ebillet_movie_delete();

CREATE OR REPLACE FUNCTION public.protect_ebillet_cinema_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.ebillet_organizers eo
    WHERE eo.cinema_id = OLD.id
      AND eo.is_active = true
  ) THEN
    RETURN NULL;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_ebillet_cinema_delete ON public.cinemas;
CREATE TRIGGER trg_protect_ebillet_cinema_delete
BEFORE DELETE ON public.cinemas
FOR EACH ROW
EXECUTE FUNCTION public.protect_ebillet_cinema_delete();
