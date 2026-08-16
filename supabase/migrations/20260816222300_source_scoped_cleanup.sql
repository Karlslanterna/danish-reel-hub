-- Source-scoped cleanup safety.
-- Never let a generic stale-data cleanup remove authoritative eBillet rows.
-- The application cleanup currently deletes by date without a source predicate;
-- this migration adds a database helper that can be used by future cleanup jobs.

CREATE OR REPLACE FUNCTION public.cleanup_kultunaut_stale_data(cutoff_date date)
RETURNS TABLE(showtimes_deleted integer, movies_deleted integer, cinemas_deleted integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_showtimes integer := 0;
  deleted_movies integer := 0;
  deleted_cinemas integer := 0;
BEGIN
  DELETE FROM public.showtimes s
  WHERE s.date < cutoff_date
    AND COALESCE(s.source, 'kultunaut') = 'kultunaut'
    AND NOT EXISTS (
      SELECT 1
      FROM public.ebillet_organizers eo
      WHERE eo.cinema_id = s.cinema_id
        AND eo.is_active = true
    );
  GET DIAGNOSTICS deleted_showtimes = ROW_COUNT;

  DELETE FROM public.movies m
  WHERE NOT EXISTS (SELECT 1 FROM public.showtimes s WHERE s.movie_id = m.id);
  GET DIAGNOSTICS deleted_movies = ROW_COUNT;

  DELETE FROM public.cinemas c
  WHERE NOT EXISTS (SELECT 1 FROM public.showtimes s WHERE s.cinema_id = c.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.ebillet_organizers eo
      WHERE eo.cinema_id = c.id AND eo.is_active = true
    );
  GET DIAGNOSTICS deleted_cinemas = ROW_COUNT;

  RETURN QUERY SELECT deleted_showtimes, deleted_movies, deleted_cinemas;
END;
$$;

COMMENT ON FUNCTION public.cleanup_kultunaut_stale_data(date) IS
  'Source-scoped cleanup for Kultunaut data. Never deletes eBillet-authoritative showtimes or cinemas.';
