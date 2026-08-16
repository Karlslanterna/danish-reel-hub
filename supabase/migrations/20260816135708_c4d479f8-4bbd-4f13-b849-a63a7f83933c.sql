CREATE OR REPLACE FUNCTION private.cinema_is_public(_cinema_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cinemas c
    LEFT JOIN public.ebillet_organizers o ON o.id = c.ebillet_organizer_id
    WHERE c.id = _cinema_id
      AND (c.ebillet_organizer_id IS NULL OR o.is_active)
  );
$$;

DROP POLICY IF EXISTS "Public can read showtimes" ON public.showtimes;
CREATE POLICY "Public can read showtimes"
ON public.showtimes
FOR SELECT
TO anon, authenticated
USING (private.cinema_is_public(cinema_id));

CREATE OR REPLACE VIEW public.movies_ranked
WITH (security_invoker = on) AS
SELECT m.id,
    m.title,
    m.original_title,
    m.runtime,
    m.genre,
    m.year,
    m.director,
    m.rating,
    m.synopsis,
    m.poster,
    m.created_at,
    m.slug,
    m.external_id,
    m.trailer_url,
    m.release_date,
    m.tmdb_id,
    m.tmdb_runtime,
    m.tmdb_overview,
    m.tmdb_genres,
    m.tmdb_poster_url,
    m.tmdb_backdrop_url,
    m.tmdb_trailer_url,
    m.tmdb_cast,
    m.tmdb_director,
    m.tmdb_vote_average,
    m.tmdb_fetched_at,
    m.tmdb_status,
    m.tmdb_skip_reason,
    COALESCE(s.screening_count, 0::bigint) AS screening_count,
    s.next_screening_date
   FROM public.movies m
     LEFT JOIN ( SELECT st.movie_id,
            sum(GREATEST(COALESCE(array_length(st.times, 1), 0), 1)) AS screening_count,
            min(st.date) AS next_screening_date
           FROM public.showtimes st
           JOIN public.cinemas c ON c.id = st.cinema_id
          WHERE st.date >= to_char((now() AT TIME ZONE 'Europe/Copenhagen'::text)::date::timestamp with time zone, 'YYYY-MM-DD'::text)
            AND private.cinema_is_public(st.cinema_id)
          GROUP BY st.movie_id) s ON s.movie_id = m.id;

GRANT SELECT ON public.movies_ranked TO anon, authenticated;