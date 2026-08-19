create or replace function public.get_movie_showtime_schedule(
  p_movie_ids text[],
  p_starts_after timestamptz,
  p_first_date date,
  p_last_date date
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'movie_id', grouped.movie_id,
        'cinema_id', grouped.cinema_id,
        'local_date', grouped.local_date,
        'hall', grouped.hall,
        'times', grouped.times,
        'formats', grouped.formats,
        'languages', grouped.languages,
        'events', grouped.events
      )
      order by grouped.local_date, grouped.first_start, grouped.hall, grouped.cinema_id
    ),
    '[]'::jsonb
  )
  from (
    select
      screenings.movie_id,
      screenings.cinema_id,
      screenings.local_date,
      screenings.hall,
      coalesce(screenings.formats, '{}'::text[]) as formats,
      coalesce(screenings.languages, '{}'::text[]) as languages,
      coalesce(screenings.events, '{}'::text[]) as events,
      min(screenings.starts_at) as first_start,
      array_agg(
        to_char(screenings.local_time, 'HH24:MI')
        order by screenings.starts_at, screenings.id
      ) as times
    from public.screenings
    where screenings.movie_id = any(p_movie_ids)
      and screenings.starts_at >= p_starts_after
      and screenings.local_date between p_first_date and p_last_date
    group by
      screenings.movie_id,
      screenings.cinema_id,
      screenings.local_date,
      screenings.hall,
      coalesce(screenings.formats, '{}'::text[]),
      coalesce(screenings.languages, '{}'::text[]),
      coalesce(screenings.events, '{}'::text[])
  ) as grouped;
$$;

revoke all on function public.get_movie_showtime_schedule(text[], timestamptz, date, date)
from public;

grant execute on function public.get_movie_showtime_schedule(text[], timestamptz, date, date)
to anon, authenticated;
