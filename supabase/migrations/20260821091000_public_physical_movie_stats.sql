-- Public ranking must count a physical screening once even when the same
-- movie/cinema/start is supplied by both eBillet and Kultunaut.
--
-- Movie consolidation remains owned by the application because it has the
-- conservative title/year/TMDb/synopsis rules. The application supplies each
-- public movie's source ids; this function only performs the cheap database
-- aggregation across those already-approved groups.
create or replace function public.get_public_movie_physical_stats(
  p_groups jsonb,
  p_last_date date default null
)
returns table (
  public_id text,
  screening_count bigint,
  next_screening_date text
)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select
      (now() at time zone 'Europe/Copenhagen')::date as first_date,
      least(
        coalesce(
          p_last_date,
          (now() at time zone 'Europe/Copenhagen')::date + 30
        ),
        (now() at time zone 'Europe/Copenhagen')::date + 30
      ) as last_date
  ),
  public_groups as (
    select
      group_row.value ->> 'id' as public_id,
      source_row.value as movie_id
    from jsonb_array_elements(coalesce(p_groups, '[]'::jsonb))
      with ordinality as group_row(value, group_no)
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(group_row.value -> 'sourceIds') = 'array'
          then group_row.value -> 'sourceIds'
        else jsonb_build_array(group_row.value ->> 'id')
      end
    ) with ordinality as source_row(value, source_no)
    where group_row.group_no <= 250
      and source_row.source_no <= 32
      and coalesce(group_row.value ->> 'id', '') <> ''
      and coalesce(source_row.value, '') <> ''
  ),
  -- These are source rows already confirmed by the public cinema catalogue to
  -- describe the same physical venue. Most eBillet venues are canonicalized in
  -- the import pipeline itself; this list covers the remaining explicit public
  -- aliases so cross-source rows dedupe in exactly the same places as the UI.
  cinema_aliases(alias_id, canonical_id) as (
    values
      ('eb-168','kn-28463'),
      ('eb-192','kn-51903'),
      ('eb-202','kn-251004'),
      ('eb-171','kn-50143'),
      ('eb-118','kn-2037655'),
      ('eb-159','kn-891061'),
      ('eb-177','kn-891095'),
      ('eb-178','kn-2273815'),
      ('eb-214','kn-8561'),
      ('eb-231','kn-891074'),
      ('eb-167','kn-367'),
      ('eb-218','kn-9809'),
      ('eb-179','kn-5225'),
      ('eb-235','kn-16963'),
      ('eb-201','kn-133208'),
      ('eb-122','kn-321249'),
      ('eb-234','kn-891057'),
      ('eb-210','kn-341816'),
      ('eb-197','kn-2022878'),
      ('eb-126','kn-891098'),
      ('eb-175','kn-133318'),
      ('eb-149','kn-171004'),
      ('eb-165','kn-641227'),
      ('eb-123','kn-891102'),
      ('eb-104','kn-2016163')
  ),
  physical as (
    select distinct
      g.public_id,
      coalesce(a.canonical_id, s.cinema_id) as physical_cinema_id,
      s.starts_at,
      s.local_date
    from public_groups g
    join public.screenings s on s.movie_id = g.movie_id
    join public.cinemas c on c.id = s.cinema_id
    left join public.ebillet_organizers o on o.id = c.ebillet_organizer_id
    left join cinema_aliases a on a.alias_id = s.cinema_id
    cross join bounds b
    where s.starts_at >= now()
      and s.local_date >= b.first_date
      and s.local_date <= b.last_date
      and (c.ebillet_organizer_id is null or o.is_active)
  )
  select
    p.public_id,
    count(*)::bigint as screening_count,
    to_char(min(p.local_date), 'YYYY-MM-DD') as next_screening_date
  from physical p
  group by p.public_id;
$$;

revoke all on function public.get_public_movie_physical_stats(jsonb, date) from public;
grant execute on function public.get_public_movie_physical_stats(jsonb, date)
  to anon, authenticated, service_role;

comment on function public.get_public_movie_physical_stats(jsonb, date) is
  'Counts deduplicated public physical screenings for application-approved movie identity groups: one movie + physical cinema + advertised start time equals one screening.';
