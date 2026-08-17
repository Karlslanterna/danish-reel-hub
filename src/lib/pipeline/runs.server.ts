/**
 * One durable job model for every source.
 *
 * A run owns a (source, scope) and holds a time-boxed lease. A worker claims
 * a run, checkpoints its cursor after each unit of work and heartbeats the
 * lease; if the worker dies the lease expires and the next invocation resumes
 * from the checkpoint instead of restarting the whole import.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ImportSource } from "./types";

export type RunState = "queued" | "running" | "paused" | "completed" | "failed" | "dead_letter";

export type ImportRun = {
  id: string;
  source: ImportSource;
  scopeType: string;
  scopeKey: string;
  snapshotId: string | null;
  state: RunState;
  cursor: Record<string, unknown> | null;
  attempts: number;
  leaseUntil: string | null;
  stats: Record<string, unknown>;
  lastError: string | null;
};

export const MAX_ATTEMPTS = 5;
export const DEFAULT_LEASE_SECONDS = 120;

type Row = {
  id: string;
  source: string;
  scope_type: string;
  scope_key: string;
  snapshot_id: string | null;
  state: string;
  cursor: unknown;
  attempts: number;
  lease_until: string | null;
  stats: unknown;
  last_error: string | null;
};

function toRun(r: Row): ImportRun {
  return {
    id: r.id,
    source: r.source as ImportSource,
    scopeType: r.scope_type,
    scopeKey: r.scope_key,
    snapshotId: r.snapshot_id,
    state: r.state as RunState,
    cursor: (r.cursor as Record<string, unknown> | null) ?? null,
    attempts: r.attempts,
    leaseUntil: r.lease_until,
    stats: (r.stats as Record<string, unknown>) ?? {},
    lastError: r.last_error,
  };
}

/** Pure lease check — a run is claimable when it has no live lease. */
export function isClaimable(
  run: { state: RunState; leaseUntil: string | null },
  now = new Date(),
): boolean {
  if (run.state !== "queued" && run.state !== "running") return false;
  if (!run.leaseUntil) return true;
  return Date.parse(run.leaseUntil) < now.getTime();
}

/** Pure escalation rule for a crashed/failing run. */
export function nextStateAfterFailure(attempts: number): RunState {
  return attempts >= MAX_ATTEMPTS ? "dead_letter" : "queued";
}

export async function createRun(input: {
  source: ImportSource;
  scopeType: string;
  scopeKey: string;
  snapshotId?: string | null;
  cursor?: Record<string, unknown>;
}): Promise<ImportRun> {
  const { data, error } = await supabaseAdmin
    .from("import_runs")
    .insert({
      source: input.source,
      scope_type: input.scopeType,
      scope_key: input.scopeKey,
      snapshot_id: input.snapshotId ?? null,
      cursor: JSON.parse(JSON.stringify(input.cursor ?? {})),
      state: "queued",
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`run: create failed — ${error?.message}`);
  return toRun(data as Row);
}

/** Atomically claim the oldest claimable run for a source. */
export async function claimRun(
  source: ImportSource,
  leaseSeconds = DEFAULT_LEASE_SECONDS,
): Promise<ImportRun | null> {
  const { data, error } = await supabaseAdmin.rpc("claim_import_run", {
    p_source: source,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error(`run: claim failed — ${error.message}`);
  const rows = (data ?? []) as unknown as Row[];
  return rows.length ? toRun(rows[0]) : null;
}

export async function getRun(runId: string): Promise<ImportRun | null> {
  const { data, error } = await supabaseAdmin
    .from("import_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new Error(`run: read failed — ${error.message}`);
  return data ? toRun(data as Row) : null;
}

/** Checkpoint progress and extend the lease. Safe to call after each unit. */
export async function checkpoint(
  runId: string,
  cursor: Record<string, unknown>,
  stats?: Record<string, unknown>,
  leaseSeconds = DEFAULT_LEASE_SECONDS,
): Promise<void> {
  const patch: Record<string, unknown> = {
    cursor: JSON.parse(JSON.stringify(cursor)),
    last_heartbeat: new Date().toISOString(),
    lease_until: new Date(Date.now() + leaseSeconds * 1000).toISOString(),
    state: "running",
  };
  if (stats) patch.stats = JSON.parse(JSON.stringify(stats));
  const { error } = await supabaseAdmin.from("import_runs").update(patch).eq("id", runId);
  if (error) throw new Error(`run: checkpoint failed — ${error.message}`);
}

export async function attachSnapshot(runId: string, snapshotId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("import_runs")
    .update({ snapshot_id: snapshotId })
    .eq("id", runId);
  if (error) throw new Error(`run: snapshot attach failed — ${error.message}`);
}

export async function completeRun(
  runId: string,
  stats: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("import_runs")
    .update({
      state: "completed",
      finished_at: new Date().toISOString(),
      lease_until: null,
      stats: JSON.parse(JSON.stringify(stats)),
    })
    .eq("id", runId);
  if (error) throw new Error(`run: complete failed — ${error.message}`);
}

/** Release a run after a failure so a later invocation can resume it. */
export async function failRun(runId: string, message: string): Promise<RunState> {
  const run = await getRun(runId);
  const state = nextStateAfterFailure(run?.attempts ?? MAX_ATTEMPTS);
  const { error } = await supabaseAdmin
    .from("import_runs")
    .update({
      state,
      last_error: message.slice(0, 2000),
      lease_until: null,
      finished_at: state === "dead_letter" ? new Date().toISOString() : null,
    })
    .eq("id", runId);
  if (error) throw new Error(`run: fail update failed — ${error.message}`);
  return state;
}

/** Requeue runs whose worker died mid-flight (lease expired). */
export async function reapExpiredRuns(source: ImportSource): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("import_runs")
    .update({ state: "queued", lease_until: null })
    .eq("source", source)
    .eq("state", "running")
    .lt("lease_until", new Date().toISOString())
    .select("id");
  if (error) throw new Error(`run: reap failed — ${error.message}`);
  return data?.length ?? 0;
}
