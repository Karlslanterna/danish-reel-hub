-- Harden source isolation between Kultunaut and eBillet.
-- eBillet owns showtimes for every cinema linked to an eBillet organizer.
-- Kultunaut writes are rejected at the database boundary, independent of
-- whether the caller remembered to populate showtimes.source.

CREATE OR REPLACE FUNCTION public.enforce_showtime_source_authority()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cinema_organizer integer;
BEGIN
  SELECT ebillet_organizer_id
    INTO cinema_organizer
  FROM public.cinemas
  WHERE id = NEW.cinema_id;

  IF cinema_organizer IS NOT NULL
     AND lower(coalesce(NEW.source, '')) <> 'ebillet' THEN
    -- NULL is important here: the legacy Kultunaut importer did not set
    -- source on updates/inserts. Such writes must not reach eBillet cinemas.
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

CREATE OR REPLACE FUNCTION public.enforce_cinema_source_authority()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.ebillet_organizer_id IS NOT NULL
     AND lower(coalesce(NEW.source, '')) <> 'ebillet' THEN
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

-- The Kultunaut cleanup routine historically deletes all past showtimes.
-- Protect eBillet rows so a source-agnostic cleanup cannot erase them.
CREATE OR REPLACE FUNCTION public.protect_ebillet_showtime_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cinema_organizer integer;
BEGIN
  SELECT ebillet_organizer_id
    INTO cinema_organizer
  FROM public.cinemas
  WHERE id = OLD.cinema_id;

  IF cinema_organizer IS NOT NULL
     AND lower(coalesce(OLD.source, '')) = 'ebillet' THEN
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

-- Never let the generic Kultunaut orphan cleanup remove an eBillet-backed
-- cinema. eBillet owns the venue identity once ebillet_organizer_id exists.
CREATE OR REPLACE FUNCTION public.protect_ebillet_cinema_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.ebillet_organizer_id IS NOT NULL THEN
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

-- Protect movies carrying eBillet identity, and movies still referenced by an
-- eBillet showtime, from the generic orphan cleanup.
CREATE OR REPLACE FUNCTION public.protect_ebillet_movie_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.ebillet_movie_base_id IS NOT NULL
     OR coalesce(array_length(OLD.ebillet_movie_ids, 1), 0) > 0
     OR EXISTS (
       SELECT 1
       FROM public.showtimes s
       WHERE s.movie_id = OLD.id
         AND lower(coalesce(s.source, '')) = 'ebillet'
     ) THEN
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

-- Remove any stale legacy Kultunaut rows that survived on cinemas now owned by
-- eBillet. This is deliberately limited to rows whose source is not eBillet;
-- current eBillet snapshots remain untouched.
DELETE FROM public.showtimes s
USING public.cinemas c
WHERE c.id = s.cinema_id
  AND c.ebillet_organizer_id IS NOT NULL
  AND lower(coalesce(s.source, '')) <> 'ebillet';

-- Remove duplicate Kultunaut showtime rows introduced by repeated imports.
-- Keep one row per movie/cinema/date/hall/times signature. eBillet rows are not
-- included in this repair.
WITH ranked AS (
  SELECT
    s.id,
    row_number() OVER (
      PARTITION BY s.movie_id, s.cinema_id, s.date, s.hall, s.times
      ORDER BY s.id
    ) AS rn
  FROM public.showtimes s
  WHERE lower(coalesce(s.source, '')) <> 'ebillet'
)
DELETE FROM public.showtimes s
USING ranked r
WHERE s.id = r.id
  AND r.rn > 1;

COMMENT ON FUNCTION public.enforce_showtime_source_authority() IS
  'eBillet-owned cinemas accept showtime writes only when source=ebillet.';
COMMENT ON FUNCTION public.protect_ebillet_showtime_delete() IS
  'Prevents generic cleanup from deleting eBillet showtimes.';
COMMENT ON FUNCTION public.protect_ebillet_cinema_delete() IS
  'Prevents generic cleanup from deleting eBillet-owned cinemas.';
COMMENT ON FUNCTION public.protect_ebillet_movie_delete() IS
  'Prevents generic cleanup from deleting movies carrying eBillet identity.';
