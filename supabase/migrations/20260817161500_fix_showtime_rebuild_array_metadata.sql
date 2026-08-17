-- Compatibility rebuild must preserve array-typed metadata without aggregating
-- arrays into a higher-dimensional PostgreSQL array. The previous expression
-- `(array_agg(s.formats))[1]` resolves to a scalar element (and can also fail
-- when empty/non-empty arrays have different dimensions), which breaks the
-- legacy showtimes rebuild after a canonical promotion.

CREATE OR REPLACE FUNCTION public.rebuild_showtimes_for_cinema(
  p_source text,
  p_cinema_id text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  DELETE FROM public.showtimes
  WHERE cinema_id = p_cinema_id
    AND source = p_source;

  INSERT INTO public.showtimes (
    movie_id, cinema_id, date, hall, times, ticket_url, ticket_urls, booking_url,
    start_time, formats, languages, events, source, min_price, max_price, free_seats
  )
  WITH grouped AS (
    SELECT
      s.movie_id,
      s.cinema_id,
      s.local_date,
      s.hall,
      array_agg(to_char(s.local_time, 'HH24:MI') ORDER BY s.starts_at, s.source_ref) AS times,
      array_agg(coalesce(s.ticket_url, '') ORDER BY s.starts_at, s.source_ref) AS ticket_urls,
      min(s.starts_at) AS start_time,
      min(s.price_min) AS min_price,
      max(s.price_max) AS max_price,
      sum(s.free_seats) AS free_seats
    FROM public.screenings s
    WHERE s.cinema_id = p_cinema_id
      AND s.source = p_source
    GROUP BY s.movie_id, s.cinema_id, s.local_date, s.hall
  ),
  first_meta AS (
    SELECT DISTINCT ON (s.movie_id, s.cinema_id, s.local_date, s.hall)
      s.movie_id,
      s.cinema_id,
      s.local_date,
      s.hall,
      s.formats,
      s.languages,
      s.events
    FROM public.screenings s
    WHERE s.cinema_id = p_cinema_id
      AND s.source = p_source
    ORDER BY s.movie_id, s.cinema_id, s.local_date, s.hall, s.starts_at, s.source_ref
  )
  SELECT
    g.movie_id,
    g.cinema_id,
    to_char(g.local_date, 'YYYY-MM-DD'),
    g.hall,
    g.times,
    g.ticket_urls[1],
    g.ticket_urls,
    g.ticket_urls[1],
    g.start_time,
    m.formats,
    m.languages,
    m.events,
    p_source,
    g.min_price,
    g.max_price,
    g.free_seats
  FROM grouped g
  JOIN first_meta m
    USING (movie_id, cinema_id, local_date, hall)
  ON CONFLICT (movie_id, cinema_id, date, hall, source) DO UPDATE SET
    times = EXCLUDED.times,
    ticket_urls = EXCLUDED.ticket_urls,
    ticket_url = EXCLUDED.ticket_url,
    booking_url = EXCLUDED.booking_url,
    start_time = EXCLUDED.start_time,
    formats = EXCLUDED.formats,
    languages = EXCLUDED.languages,
    events = EXCLUDED.events,
    min_price = EXCLUDED.min_price,
    max_price = EXCLUDED.max_price,
    free_seats = EXCLUDED.free_seats;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.rebuild_showtimes_for_cinema(text, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rebuild_showtimes_for_cinema(text, text)
  TO service_role;

COMMENT ON FUNCTION public.rebuild_showtimes_for_cinema(text, text) IS
  'Compatibility-only grouped showtimes rebuild from canonical screenings. Array metadata is copied from the first physical screening in each group.';
