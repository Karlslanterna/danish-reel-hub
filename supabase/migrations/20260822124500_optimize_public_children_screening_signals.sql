-- The first compact child-signal RPC still joined one requested-id row at a
-- time, causing hundreds of index probes and temporary spill on the production
-- set. Use the existing (movie_id, starts_at) index once with ANY instead.
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
  with filtered as materialized (
    select
      s.movie_id,
      coalesce(s.events, '{}'::text[]) as events,
      coalesce(s.languages, '{}'::text[]) as languages
    from public.screenings s
    where s.movie_id = any(coalesce((p_movie_ids)[1:1000], '{}'::text[]))
      and s.starts_at >= p_starts_after
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

comment on function public.get_public_children_screening_signals(text[], timestamptz, date, date) is
  'Compact source-movie event/language evidence for the conservative /for-boern classifier; bounded to the first 1000 requested ids and resolved via the movie/start index.';
