-- The homepage ranking must read the canonical one-row-per-screening model.
-- `showtimes` is compatibility-only and must not influence public ranking.
--
-- Keep the existing public view column contract stable. `movies` has gained
-- internal source-specific columns since this view was first created, so using
-- `m.*` here would silently change/reorder the public view schema.
CREATE OR REPLACE VIEW public.movies_ranked
WITH (security_invoker = true)
AS
SELECT
  m.id,
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
LEFT JOIN (
  SELECT
    st.movie_id,
    count(*)::bigint AS screening_count,
    to_char(min(st.local_date), 'YYYY-MM-DD') AS next_screening_date
  FROM public.screenings st
  WHERE st.local_date >= (now() AT TIME ZONE 'Europe/Copenhagen')::date
  GROUP BY st.movie_id
) s ON s.movie_id = m.id;

GRANT SELECT ON public.movies_ranked TO anon, authenticated;

COMMENT ON VIEW public.movies_ranked IS
  'Public movie ranking derived exclusively from canonical screenings. One screenings row equals one physical screening; public view schema remains compatibility-stable.';
