-- `/for-boern` only consumes screening-level event/language evidence from the
-- national showtime index. Aggregate that evidence in PostgreSQL so SSR reads
-- one compact row per source movie instead of transferring/paginating every
-- active screening row through PostgREST.
create or replace function public.get_public_children_screening_signals(
  p_movie_ids text[],
  p_starts_after timestamptz,
  p_first_date date,
  p_last_date date
)
returns table (
  movie_id text,
  events text[],
  languages text[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  with requested as (
    select distinct requested_id as movie_id
    from unnest(coalesce(p_movie_ids, '{}'::text[]))
      with ordinality as requested_id_row(requested_id, requested_no)
    where requested_id_row.requested_no <= 1000
      and coalesce(requested_id_row.requested_id, '') <> ''
  ),
  filtered as materialized (
    select
      s.movie_id,
      coalesce(s.events, '{}'::text[]) as events,
      coalesce(s.languages, '{}'::text[]) as languages
    from requested r
    join public.screenings s on s.movie_id = r.movie_id
    where s.starts_at >= p_starts_after
      and s.local_date between p_first_date and p_last_date
  ),
  movie_ids as (
    select distinct filtered.movie_id
    from filtered
  ),
  event_values as (
    select distinct filtered.movie_id, event_value.value
    from filtered
    cross join lateral unnest(filtered.events) as event_value(value)
  ),
  language_values as (
    select distinct filtered.movie_id, language_value.value
    from filtered
    cross join lateral unnest(filtered.languages) as language_value(value)
  ),
  events_by_movie as (
    select event_values.movie_id, array_agg(event_values.value order by event_values.value) as events
    from event_values
    group by event_values.movie_id
  ),
  languages_by_movie as (
    select language_values.movie_id, array_agg(language_values.value order by language_values.value) as languages
    from language_values
    group by language_values.movie_id
  )
  select
    movie_ids.movie_id,
    coalesce(events_by_movie.events, '{}'::text[]) as events,
    coalesce(languages_by_movie.languages, '{}'::text[]) as languages
  from movie_ids
  left join events_by_movie using (movie_id)
  left join languages_by_movie using (movie_id)
  order by movie_ids.movie_id;
$$;

revoke all on function public.get_public_children_screening_signals(text[], timestamptz, date, date)
from public;

grant execute on function public.get_public_children_screening_signals(text[], timestamptz, date, date)
to anon, authenticated, service_role;

comment on function public.get_public_children_screening_signals(text[], timestamptz, date, date) is
  'Compact source-movie event/language evidence for the conservative /for-boern classifier; bounded to 1000 requested ids per call.';
