create or replace function public.get_public_showtime_index(
  p_starts_after timestamptz,
  p_first_date date,
  p_last_date date,
  p_cinema_ids text[] default null
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
        'times', grouped.times,
        'formats', grouped.formats,
        'languages', grouped.languages,
        'events', grouped.events
      )
      order by grouped.local_date, grouped.first_start, grouped.movie_id, grouped.cinema_id
    ),
    '[]'::jsonb
  )
  from (
    select
      screenings.movie_id,
      screenings.cinema_id,
      screenings.local_date,
      coalesce(screenings.formats, '{}'::text[]) as formats,
      coalesce(screenings.languages, '{}'::text[]) as languages,
      coalesce(screenings.events, '{}'::text[]) as events,
      min(screenings.starts_at) as first_start,
      array_agg(
        distinct to_char(screenings.local_time, 'HH24:MI')
        order by to_char(screenings.local_time, 'HH24:MI')
      ) as times
    from public.screenings
    where screenings.starts_at >= p_starts_after
      and screenings.local_date between p_first_date and p_last_date
      and (p_cinema_ids is null or screenings.cinema_id = any(p_cinema_ids))
    group by
      screenings.movie_id,
      screenings.cinema_id,
      screenings.local_date,
      coalesce(screenings.formats, '{}'::text[]),
      coalesce(screenings.languages, '{}'::text[]),
      coalesce(screenings.events, '{}'::text[])
  ) as grouped;
$$;

revoke all on function public.get_public_showtime_index(timestamptz, date, date, text[])
from public;

grant execute on function public.get_public_showtime_index(timestamptz, date, date, text[])
to anon, authenticated;
