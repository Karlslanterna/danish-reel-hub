create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create or replace function private.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

revoke all on function private.has_role(uuid, public.app_role) from public, anon;
grant execute on function private.has_role(uuid, public.app_role) to authenticated, service_role;

drop policy if exists "Admins can read ebillet organizers" on public.ebillet_organizers;
create policy "Admins can read ebillet organizers" on public.ebillet_organizers
  for select to authenticated using (private.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins can read ebillet sync runs" on public.ebillet_sync_runs;
create policy "Admins can read ebillet sync runs" on public.ebillet_sync_runs
  for select to authenticated using (private.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins can read health events" on public.import_health_events;
create policy "Admins can read health events" on public.import_health_events
  for select to authenticated using (private.has_role(auth.uid(), 'admin'));

drop policy if exists "Admins can view scheduled import runs" on public.import_schedule_runs;
create policy "Admins can view scheduled import runs" on public.import_schedule_runs
  for select to authenticated using (private.has_role(auth.uid(), 'admin'));

drop function if exists public.has_role(uuid, public.app_role);

alter table public.scheduler_secrets enable row level security;
revoke all on public.scheduler_secrets from anon, authenticated;
grant all on public.scheduler_secrets to service_role;

drop policy if exists "No client access to scheduler secrets" on public.scheduler_secrets;
create policy "No client access to scheduler secrets" on public.scheduler_secrets
  as restrictive for all to anon, authenticated
  using (false) with check (false);