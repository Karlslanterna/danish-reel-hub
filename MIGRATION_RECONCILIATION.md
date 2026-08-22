# Migration ledger reconciliation — 2026-08-21

This document records a one-time reconciliation between the migration files in this repository and the **Lovable-connected production Supabase** migration ledger.

## Why this exists

The 2026-08-21 whole-system audit found that production runtime state and `supabase_migrations.schema_migrations` did not fully agree:

- several early Lovable-applied migrations were recorded under a timestamp a second away from their repository filename;
- a short legacy source-authority migration block from 2026-08-16 was absent from the ledger even though production had subsequently moved to the canonical screening pipeline and later ownership guards;
- several later migrations had exact runtime fingerprints in production but no ledger row (analytics, screening-event overrides, showtime aggregation RPCs, public showtime index and the eBillet retry cron).

Leaving this unresolved is unsafe because a future migration tool could interpret old repository files as unapplied and attempt to execute historical DDL/DML against a much newer production schema.

## Safety rule

**Historical migration SQL is not replayed.**

The reconciliation script in `ops/reconcile-migration-ledger-20260821.sql` only inserts rows into `supabase_migrations.schema_migrations`, and only inside a transaction after runtime/ledger preconditions are proven.

Production SQL must be executed only through Lovable's connected Supabase per `AGENTS.md`.

## Reconciliation classes

### 1. Version aliases

These repository versions correspond to an existing production ledger row whose `name` already points at the same repository migration, but whose recorded version differs slightly:

| Repository version | Existing production version |
| --- | --- |
| `20260610124419` | `20260610124418` |
| `20260612095929` | `20260612095928` |
| `20260612100531` | `20260612100530` |
| `20260615131019` | `20260615131018` |
| `20260615190837` | `20260615190836` |
| `20260615191632` | `20260615191631` |
| `20260715084958` | `20260715085000` |
| `20260728074340` | `20260728074341` |

The original production rows are retained. A repository-version alias is added so version-based migration tooling does not treat the file as new.

### 2. Superseded 2026-08-16 legacy source-authority block

Repository versions:

- `20260816215500`
- `20260816222000`
- `20260816222100`
- `20260816222300`
- `20260816223000`
- `20260816223500`

Production is demonstrably beyond these legacy steps: the canonical pipeline migrations and later eBillet ownership migration are recorded, `public.screenings` exists, and the final source-authority triggers are active. Some intermediate legacy functions/triggers from these files are absent today.

That makes retroactive execution unsafe and incorrect. These versions are ledgered as **reconciled/superseded**, not as proof that every intermediate statement historically ran.

`20260816220000` is different: its unique `ebillet_sync_runs_one_running_idx` still exists exactly, so that version is labelled runtime-verified.

### 3. Runtime-verified later migrations

These versions are absent from the ledger but have a distinct exact production fingerprint:

| Version | Verified runtime fingerprint |
| --- | --- |
| `20260818123000` | `public.analytics_events` |
| `20260818190000` | `screening_event_overrides` + `apply_screening_event_overrides()` |
| `20260819140500` | `get_movie_showtime_groups()` |
| `20260819142500` | `get_movie_showtime_schedule()` |
| `20260819213000` | `get_public_showtime_index()` |
| `20260821065000` | active `ebillet-canonical-daily-sync-retry` at `10 1 * * *` |

These are labelled runtime-verified in the repaired ledger.

## Verification after execution

After running the reconciliation script:

1. Every repository migration version through `20260821091000` must exist in `supabase_migrations.schema_migrations`.
2. No historical DDL/DML should have run; only ledger rows should change.
3. Canonical/legacy parity, production catalog audit and production smoke must remain green.
4. The current importer cron definitions and canonical screening counts must remain unchanged.

## Future rule

Do not create another parallel migration-history document. Update this file if a later reconciliation is genuinely needed.

Do not infer that a ledger row named `reconciled_superseded__...` means all statements in that old migration were executed historically. It means the repository version is intentionally closed because production has moved beyond it and retroactive execution would be unsafe.
