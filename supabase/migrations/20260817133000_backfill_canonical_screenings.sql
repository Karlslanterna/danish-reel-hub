-- Backfill the canonical import model from the proven legacy read model before
-- any public read-path cutover. This migration is deliberately additive:
-- existing canonical mappings/screenings win and are never overwritten.
--
-- The generated source_ref values match the active normalizers so the first
-- subsequent source import is idempotent rather than creating a second copy.

-- ---------------------------------------------------------------- identity
-- Persist existing Kultunaut cinema/movie identities.
INSERT INTO public.source_entity_refs (
  source, entity_type, external_id, canonical_id, match_method, confidence, locked, notes
)
SELECT 'kultunaut', 'cinema', c.external_id::text, c.id, 'backfill', 1, true,
       'Backfilled from cinemas.external_id'
FROM public.cinemas c
WHERE nullif(btrim(c.external_id::text), '') IS NOT NULL
ON CONFLICT (source, entity_type, external_id) DO NOTHING;

INSERT INTO public.source_entity_refs (
  source, entity_type, external_id, canonical_id, match_method, confidence, locked, notes
)
SELECT 'kultunaut', 'movie', m.external_id::text, m.id, 'backfill', 1, true,
       'Backfilled from movies.external_id'
FROM public.movies m
WHERE nullif(btrim(m.external_id::text), '') IS NOT NULL
ON CONFLICT (source, entity_type, external_id) DO NOTHING;

-- Persist existing eBillet organizer identities. The organizer link itself is
-- authoritative even when the organizer currently has no screenings.
INSERT INTO public.source_entity_refs (
  source, entity_type, external_id, canonical_id, match_method, confidence, locked, notes
)
SELECT 'ebillet', 'cinema', c.ebillet_organizer_id::text, c.id, 'backfill', 1, true,
       'Backfilled from cinemas.ebillet_organizer_id'
FROM public.cinemas c
WHERE c.ebillet_organizer_id IS NOT NULL
ON CONFLICT (source, entity_type, external_id) DO NOTHING;

INSERT INTO public.source_entity_refs (
  source, entity_type, external_id, canonical_id, match_method, confidence, locked, notes
)
SELECT 'ebillet', 'cinema', e.id::text, e.cinema_id, 'backfill', 1, true,
       'Backfilled from ebillet_organizers.cinema_id'
FROM public.ebillet_organizers e
WHERE e.cinema_id IS NOT NULL
ON CONFLICT (source, entity_type, external_id) DO NOTHING;

-- eBillet's movie-base id is the preferred source identity.
INSERT INTO public.source_entity_refs (
  source, entity_type, external_id, canonical_id, match_method, confidence, locked, notes
)
SELECT 'ebillet', 'movie', 'base-' || m.ebillet_movie_base_id::text, m.id,
       'backfill', 1, true, 'Backfilled from movies.ebillet_movie_base_id'
FROM public.movies m
WHERE m.ebillet_movie_base_id IS NOT NULL
  AND m.ebillet_movie_base_id > 0
ON CONFLICT (source, entity_type, external_id) DO NOTHING;

-- Version-only eBillet movies use movie-<id>. Keeping these mappings as well
-- also gives us deterministic recovery if a base id is absent upstream.
INSERT INTO public.source_entity_refs (
  source, entity_type, external_id, canonical_id, match_method, confidence, locked, notes
)
SELECT 'ebillet', 'movie', 'movie-' || x.movie_id::text, m.id,
       'backfill', 1, true, 'Backfilled from movies.ebillet_movie_ids'
FROM public.movies m
CROSS JOIN LATERAL unnest(coalesce(m.ebillet_movie_ids, '{}'::integer[])) AS x(movie_id)
WHERE x.movie_id > 0
ON CONFLICT (source, entity_type, external_id) DO NOTHING;

-- -------------------------------------------------------------- screenings
-- Explode the grouped legacy times[] into exactly one canonical row per
-- physical screening. Only rows that already obey current source authority are
-- eligible; historical cross-source residue is intentionally not copied.
WITH legacy AS (
  SELECT
    st.id AS legacy_id,
    CASE
      WHEN coalesce(st.source, '') LIKE '%ebillet%'
           OR coalesce(array_length(st.ebillet_showtime_ids, 1), 0) > 0
        THEN 'ebillet'
      ELSE 'kultunaut'
    END AS normalized_source,
    st.movie_id,
    st.cinema_id,
    st.date,
    coalesce(st.hall, '') AS hall,
    st.times,
    st.ticket_urls,
    st.ticket_url,
    st.booking_url,
    st.ebillet_showtime_ids,
    st.min_price,
    st.max_price,
    st.free_seats,
    coalesce(st.formats, '{}'::text[]) AS formats,
    coalesce(st.languages, '{}'::text[]) AS languages,
    coalesce(st.events, '{}'::text[]) AS events,
    c.external_id::text AS cinema_external_id,
    c.ebillet_organizer_id,
    m.external_id::text AS movie_external_id
  FROM public.showtimes st
  JOIN public.cinemas c ON c.id = st.cinema_id
  JOIN public.movies m ON m.id = st.movie_id
  WHERE st.date ~ '^\d{4}-\d{2}-\d{2}$'
),
exploded AS (
  SELECT
    l.*,
    t.raw_time,
    t.ord::integer AS ord,
    CASE
      WHEN l.normalized_source = 'ebillet'
       AND l.ebillet_organizer_id IS NOT NULL
       AND l.ebillet_showtime_ids[t.ord] IS NOT NULL
      THEN 'eb-' || l.ebillet_organizer_id::text || '-' || l.ebillet_showtime_ids[t.ord]::text
      WHEN l.normalized_source = 'kultunaut'
       AND nullif(btrim(l.cinema_external_id), '') IS NOT NULL
       AND nullif(btrim(l.movie_external_id), '') IS NOT NULL
      THEN 'kn-' || left(
        encode(
          extensions.digest(
            l.cinema_external_id || '|' || l.movie_external_id || '|' || l.date || '|' ||
            btrim(t.raw_time) || '|' || l.hall,
            'sha1'
          ),
          'hex'
        ),
        24
      )
      ELSE NULL
    END AS source_ref
  FROM legacy l
  CROSS JOIN LATERAL unnest(coalesce(l.times, '{}'::text[])) WITH ORDINALITY AS t(raw_time, ord)
  WHERE btrim(coalesce(t.raw_time, '')) ~ '^\d{2}:\d{2}$'
),
eligible AS (
  SELECT e.*
  FROM exploded e
  WHERE e.source_ref IS NOT NULL
    AND public.cinema_authoritative_source(e.cinema_id) = e.normalized_source
)
INSERT INTO public.screenings (
  source, source_ref, cinema_id, movie_id, starts_at, local_date, local_time, hall,
  ticket_url, price_min, price_max, free_seats, formats, languages, events, snapshot_id
)
SELECT
  e.normalized_source,
  e.source_ref,
  e.cinema_id,
  e.movie_id,
  ((e.date || ' ' || btrim(e.raw_time))::timestamp AT TIME ZONE 'Europe/Copenhagen'),
  e.date::date,
  btrim(e.raw_time)::time,
  e.hall,
  nullif(coalesce(e.ticket_urls[e.ord], e.ticket_url, e.booking_url, ''), ''),
  e.min_price,
  e.max_price,
  e.free_seats,
  e.formats,
  e.languages,
  e.events,
  NULL
FROM eligible e
ON CONFLICT DO NOTHING;

-- --------------------------------------------------------------- audit view
-- Do not switch public reads to screenings until every future legacy screening
-- is represented canonically. This view makes that gate explicit.
CREATE OR REPLACE VIEW public.screening_cutover_readiness
WITH (security_invoker = true)
AS
WITH parity AS (
  SELECT *
  FROM public.screening_model_parity
  WHERE screening_date >= (now() AT TIME ZONE 'Europe/Copenhagen')::date
),
summary AS (
  SELECT
    count(*) FILTER (WHERE delta <> 0)::bigint AS mismatched_scopes,
    coalesce(sum(abs(delta)) FILTER (WHERE delta <> 0), 0)::bigint AS physical_screening_delta,
    coalesce(sum(canonical_count), 0)::bigint AS canonical_screenings,
    coalesce(sum(legacy_count), 0)::bigint AS legacy_screenings
  FROM parity
)
SELECT
  mismatched_scopes = 0 AS ready,
  mismatched_scopes,
  physical_screening_delta,
  canonical_screenings,
  legacy_screenings
FROM summary;

GRANT SELECT ON public.screening_cutover_readiness TO authenticated;
COMMENT ON VIEW public.screening_cutover_readiness IS
  'Cutover gate. Public reads may move from showtimes to screenings only when ready=true and production source health is green.';
