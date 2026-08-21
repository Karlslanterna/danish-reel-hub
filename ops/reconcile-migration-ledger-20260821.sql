-- Lanterna production migration-ledger reconciliation — 2026-08-21
--
-- IMPORTANT: This script NEVER executes historical migration DDL/DML. It only
-- repairs supabase_migrations.schema_migrations after first proving that the
-- production database is already at/after the corresponding runtime state.
-- Run only through Lovable's connected production Supabase per AGENTS.md.

begin;

-- ---------------------------------------------------------------------------
-- 1) Version aliases.
-- Older Lovable-applied migrations were recorded one second (or, in one case,
-- a few seconds) away from their repository filename even though the ledger
-- name points at the same migration file. Add the repository version as an
-- alias; retain the original row for historical provenance.
-- ---------------------------------------------------------------------------

do $$
declare
  pair record;
begin
  for pair in
    select * from (values
      ('20260610124419','20260610124418','20260610124419_507d6583-0ce0-49ce-ad64-39649a3933e0.sql'),
      ('20260612095929','20260612095928','20260612095929_b5a1b03d-c0ce-43df-b691-625abf61d696.sql'),
      ('20260612100531','20260612100530','20260612100531_6efb3b9a-5d9c-4d00-bc12-256acb6b1561.sql'),
      ('20260615131019','20260615131018','20260615131019_5592f809-0518-4e54-9cb4-0409f5ada1ec.sql'),
      ('20260615190837','20260615190836','20260615190837_24676f43-5b35-4027-8cb0-dcbf8030cd30.sql'),
      ('20260615191632','20260615191631','20260615191632_e34782d7-4ff4-43d8-967f-0c530c0d2535.sql'),
      ('20260715084958','20260715085000','20260715084958_e4bc7a45-f318-41e9-a9f6-66d35bd0a340.sql'),
      ('20260728074340','20260728074341','20260728074340_12a02b47-b21e-4084-8b28-a893c4a38413.sql')
    ) as v(repo_version, recorded_version, expected_name)
  loop
    if not exists (
      select 1 from supabase_migrations.schema_migrations
      where version = pair.recorded_version
        and name = pair.expected_name
    ) then
      raise exception 'Ledger alias precondition failed: % is not recorded as %',
        pair.recorded_version, pair.expected_name;
    end if;

    insert into supabase_migrations.schema_migrations(version, name)
    values (
      pair.repo_version,
      'reconciled_alias_for_' || pair.recorded_version || '__' || pair.expected_name
    )
    on conflict (version) do nothing;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Legacy source-authority block from 2026-08-16.
-- Production is demonstrably beyond this legacy block: the canonical pipeline
-- migration and later eBillet ownership migration are recorded, the canonical
-- screenings table exists, and the final source-authority triggers exist.
-- Some intermediate legacy functions/triggers no longer exist, so executing
-- these old files retroactively would *diverge* production from its current
-- state. Mark the repository versions as reconciled/superseded only.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20260817104324'
  ) or not exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20260817141500'
  ) or to_regclass('public.screenings') is null
  or not exists (
    select 1 from pg_trigger
    where not tgisinternal and tgname = 'trg_showtimes_source_authority'
  ) or not exists (
    select 1 from pg_trigger
    where not tgisinternal and tgname = 'trg_cinemas_source_authority'
  ) then
    raise exception 'Legacy source-authority reconciliation preconditions failed';
  end if;

  insert into supabase_migrations.schema_migrations(version, name)
  values
    ('20260816215500','reconciled_superseded__20260816215500_source_authority.sql'),
    ('20260816222000','reconciled_superseded__20260816222000_enforce_current_source_authority.sql'),
    ('20260816222100','reconciled_superseded__20260816222100_protect_ebillet_rows_from_kultunaut_cleanup.sql'),
    ('20260816222300','reconciled_superseded__20260816222300_source_scoped_cleanup.sql'),
    ('20260816223000','reconciled_superseded__20260816223000_harden_source_isolation_and_cleanup.sql'),
    ('20260816223500','reconciled_superseded__20260816223500_normalize_showtime_source_and_local_time.sql')
  on conflict (version) do nothing;
end $$;

-- The one-running eBillet index from 16 Aug still exists exactly and can be
-- labelled runtime-verified rather than merely superseded.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'ebillet_sync_runs_one_running_idx'
  ) then
    raise exception 'Expected ebillet_sync_runs_one_running_idx is missing';
  end if;

  insert into supabase_migrations.schema_migrations(version, name)
  values ('20260816220000','reconciled_runtime_verified__20260816220000_one_running_ebillet_sync.sql')
  on conflict (version) do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Recent migrations whose exact runtime objects are present but whose
-- versions are absent from the ledger. These are safe to mark applied because
-- each migration has a distinct, directly verifiable runtime fingerprint.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.analytics_events') is null then
    raise exception 'analytics_events runtime fingerprint missing';
  end if;
  if to_regclass('public.screening_event_overrides') is null
     or to_regprocedure('public.apply_screening_event_overrides(text,text)') is null then
    raise exception 'screening_event_overrides runtime fingerprint missing';
  end if;
  if to_regprocedure('public.get_movie_showtime_groups(text[],timestamptz,date,date)') is null then
    raise exception 'get_movie_showtime_groups runtime fingerprint missing';
  end if;
  if to_regprocedure('public.get_movie_showtime_schedule(text[],timestamptz,date,date)') is null then
    raise exception 'get_movie_showtime_schedule runtime fingerprint missing';
  end if;
  if to_regprocedure('public.get_public_showtime_index(timestamptz,date,date,text[])') is null then
    raise exception 'get_public_showtime_index runtime fingerprint missing';
  end if;
  if not exists (
    select 1 from cron.job
    where jobname = 'ebillet-canonical-daily-sync-retry'
      and active
      and schedule = '10 1 * * *'
  ) then
    raise exception 'eBillet daily retry runtime fingerprint missing';
  end if;

  insert into supabase_migrations.schema_migrations(version, name)
  values
    ('20260818123000','reconciled_runtime_verified__20260818123000_create_private_analytics_events.sql'),
    ('20260818190000','reconciled_runtime_verified__20260818190000_screening_event_overrides.sql'),
    ('20260819140500','reconciled_runtime_verified__20260819140500_compact_movie_showtime_groups.sql'),
    ('20260819142500','reconciled_runtime_verified__20260819142500_movie_showtime_schedule.sql'),
    ('20260819213000','reconciled_runtime_verified__20260819213000_public_showtime_index.sql'),
    ('20260821065000','reconciled_runtime_verified__20260821065000_add_ebillet_daily_sync_retry.sql')
  on conflict (version) do nothing;
end $$;

-- Final invariant: every repository migration version that existed before this
-- reconciliation must now be represented in the ledger. This list is explicit
-- so a future repo migration cannot silently pass this historical check.
do $$
declare
  missing text[];
begin
  select array_agg(v order by v) into missing
  from unnest(array[
    '20260610124419','20260612095929','20260612095944','20260612100531','20260612100733',
    '20260615131019','20260615190837','20260615191632','20260715074521','20260715074538',
    '20260715084958','20260728074340','20260801180023','20260801180447','20260801180502',
    '20260801180530','20260812142246','20260813105331','20260813121450','20260814070005',
    '20260814071725','20260815221744','20260816123900','20260816125053','20260816135708',
    '20260816215500','20260816220000','20260816222000','20260816222100','20260816222300',
    '20260816223000','20260816223500','20260817104324','20260817104833','20260817105258',
    '20260817122500','20260817123500','20260817124500','20260817130500','20260817141500',
    '20260817152500','20260817161000','20260817161500','20260817162000','20260817162500',
    '20260817163000','20260818123000','20260818190000','20260819140500','20260819142500',
    '20260819213000','20260820162020','20260821065000','20260821091000'
  ]::text[]) v
  where not exists (
    select 1 from supabase_migrations.schema_migrations sm where sm.version = v
  );

  if missing is not null then
    raise exception 'Repository migration versions still missing after reconciliation: %', missing;
  end if;
end $$;

commit;
