CREATE OR REPLACE VIEW public.movies_ranked
WITH (security_invoker = true) AS
SELECT
  m.*,
  COALESCE(s.screening_count, 0)::bigint AS screening_count,
  s.next_screening_date
FROM public.movies m
LEFT JOIN (
  SELECT
    st.movie_id,
    SUM(GREATEST(COALESCE(array_length(st.times, 1), 0), 1))::bigint AS screening_count,
    MIN(st.date) AS next_screening_date
  FROM public.showtimes st
  WHERE st.date >= to_char((now() AT TIME ZONE 'Europe/Copenhagen')::date, 'YYYY-MM-DD')
  GROUP BY st.movie_id
) s ON s.movie_id = m.id;

GRANT SELECT ON public.movies_ranked TO anon, authenticated;
GRANT ALL ON public.movies_ranked TO service_role;

CREATE INDEX IF NOT EXISTS showtimes_date_movie_idx ON public.showtimes (date, movie_id);