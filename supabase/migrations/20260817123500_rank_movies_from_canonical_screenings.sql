-- The homepage ranking must read the canonical one-row-per-screening model.
-- `showtimes` is now compatibility-only and must not influence public ranking.
CREATE OR REPLACE VIEW public.movies_ranked
WITH (security_invoker = true)
AS
SELECT
  m.*,
  COALESCE(s.screening_count, 0::bigint) AS screening_count,
  s.next_screening_date
FROM public.movies m
LEFT JOIN (
  SELECT
    st.movie_id,
    count(*)::bigint AS screening_count,
    min(st.local_date) AS next_screening_date
  FROM public.screenings st
  WHERE st.local_date >= (now() AT TIME ZONE 'Europe/Copenhagen')::date
  GROUP BY st.movie_id
) s ON s.movie_id = m.id;

GRANT SELECT ON public.movies_ranked TO anon, authenticated;

COMMENT ON VIEW public.movies_ranked IS
  'Public movie ranking derived exclusively from canonical screenings. One screenings row equals one physical screening.';
