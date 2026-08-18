create table if not exists public.screening_event_overrides (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('kultunaut', 'ebillet')),
  source_ref text not null,
  event text not null check (event in ('Babybio', 'Seniorbio', 'Filmporten', 'Biografklub Danmark')),
  action text not null check (action in ('add', 'remove')),
  note text not null check (length(trim(note)) >= 3),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_ref, event)
);

create index if not exists screening_event_overrides_active_idx
  on public.screening_event_overrides (source, source_ref)
  where active;

alter table public.screening_event_overrides enable row level security;
revoke all on table public.screening_event_overrides from public, anon, authenticated;
grant all on table public.screening_event_overrides to service_role;

create or replace function public.apply_screening_event_overrides(
  p_source text,
  p_cinema_id text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
  v_row record;
begin
  for v_row in
    select source_ref, event, action
    from public.screening_event_overrides
    where active and source = p_source
    order by updated_at, id
  loop
    update public.screenings s
    set events = case
      when v_row.action = 'add' then array(
        select distinct unnest(coalesce(s.events, '{}'::text[]) || array[v_row.event])
      )
      when v_row.action = 'remove' then array_remove(coalesce(s.events, '{}'::text[]), v_row.event)
      else s.events
    end,
    updated_at = now()
    where s.source = p_source
      and s.cinema_id = p_cinema_id
      and s.source_ref = v_row.source_ref;
    v_updated := v_updated + case when found then 1 else 0 end;
  end loop;
  return v_updated;
end;
$$;

revoke all on function public.apply_screening_event_overrides(text, text)
  from public, anon, authenticated;
grant execute on function public.apply_screening_event_overrides(text, text) to service_role;

comment on table public.screening_event_overrides is
  'Auditable manual add/remove corrections reapplied after every source import.';
