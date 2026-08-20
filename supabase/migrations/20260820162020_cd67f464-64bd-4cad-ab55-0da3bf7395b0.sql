create or replace function public.get_home_shell_movies(p_limit integer default 40)
returns table (
  id text,
  slug text,
  title text,
  original_title text,
  runtime integer,
  genre text[],
  year integer,
  director text,
  rating text,
  poster jsonb,
  release_date date,
  tmdb_id integer,
  tmdb_runtime integer,
  tmdb_genres text[],
  tmdb_poster_url text,
  tmdb_director text,
  screening_count bigint,
  next_screening_date text,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select
      (now() at time zone 'Europe/Copenhagen')::date as first_date,
      ((now() at time zone 'Europe/Copenhagen')::date + 30) as last_date,
      greatest(1, least(coalesce(p_limit, 40), 200)) as lim
  ),
  counts as (
    select
      s.movie_id,
      count(*)::bigint as screening_count,
      to_char(min(s.local_date), 'YYYY-MM-DD') as next_screening_date
    from public.screenings s
    join public.cinemas c on c.id = s.cinema_id
    left join public.ebillet_organizers o on o.id = c.ebillet_organizer_id
    cross join bounds b
    where s.local_date >= b.first_date
      and s.local_date <= b.last_date
      and (c.ebillet_organizer_id is null or o.is_active)
    group by s.movie_id
  ),
  ranked as (
    select
      m.id,
      m.slug,
      m.title,
      m.original_title,
      m.runtime,
      m.genre,
      m.year,
      m.director,
      m.rating,
      m.poster,
      m.release_date,
      m.tmdb_id,
      m.tmdb_runtime,
      m.tmdb_genres,
      m.tmdb_poster_url,
      m.tmdb_director,
      counts.screening_count,
      counts.next_screening_date
    from public.movies m
    join counts on counts.movie_id = m.id
  )
  select
    ranked.*,
    (select count(*)::bigint from ranked) as total_count
  from ranked
  order by ranked.screening_count desc, ranked.next_screening_date asc, ranked.title asc
  limit (select lim * 3 from bounds);
$$;

revoke all on function public.get_home_shell_movies(integer) from public;
grant execute on function public.get_home_shell_movies(integer) to anon, authenticated, service_role;

comment on function public.get_home_shell_movies(integer) is
  'Bounded homepage shell read: top-ranked public movies for the today..today+30 Europe/Copenhagen window, counting only screenings at publicly visible cinemas.';