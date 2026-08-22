/**
 * Durable eBillet driver for the canonical import pipeline.
 *
 * One `import_runs` row represents exactly one organizer. The database lease
 * prevents two workers from processing the same organizer, and an expired
 * lease makes a crashed job reclaimable on the next scheduler tick.
 *
 * A sync cycle is finite: organizers are enqueued only when there are no
 * queued/running organizer jobs. Scheduled resume calls normally drain only
 * existing work. They may opt into stale-only recovery so a missed daily HTTP
 * start can self-heal without turning the resume cron into a continuous loop.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  claimRun,
  completeRun,
  failRun,
  reapExpiredRuns,
  type RunState,
} from "@/lib/pipeline/runs.server";
import { runOrganizerPipeline } from "./pipeline.server";

export type EbilletQueueResult = {
  done: boolean;
  status: "idle" | "running" | "completed" | "retrying" | "dead_letter";
  message: string;
  runId: string | null;
  organizerId: number | null;
  remaining: number;
  queued: number;
  result?: {
    cinemaId: string | null;
    movies: number;
    screenings: number;
    upserted: number;
    deleted: number;
    skipped: boolean;
    reason?: string | null;
  };
};

type QueueRpcResult = {
  data: unknown;
  error: { message: string } | null;
};

export type EbilletQueueOptions = {
  /** False for resume-only scheduler ticks. */
  allowStart?: boolean;
  /** Explicit operator action may bypass the normal freshness interval. */
  forceQueue?: boolean;
  /**
   * Resume-only callers may enqueue a fresh cycle only when the newest
   * completed organizer is at least this old. Omit to keep strict drain-only
   * behaviour.
   */
  recoverAfterMs?: number;
};

/** Avoid immediately starting a fresh full scan after the previous one drains. */
export const EBILLET_MIN_CYCLE_INTERVAL_MS = 15 * 60 * 1000;

/**
 * The 26-hour import-health alarm leaves a two-hour recovery window after this
 * threshold. A healthy daily 01:00 cycle refreshes the timestamp before a
 * resume tick can reach this age.
 */
export const EBILLET_RECOVERY_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function shouldStartEbilletCycle(input: {
  activeRuns: number;
  lastCompletedAt: string | null;
  allowStart?: boolean;
  force?: boolean;
  recoverAfterMs?: number;
  nowMs?: number;
  minIntervalMs?: number;
}): boolean {
  if (input.activeRuns > 0) return false;

  const allowStart = input.allowStart ?? true;
  const nowMs = input.nowMs ?? Date.now();

  if (!allowStart) {
    if (input.recoverAfterMs === undefined) return false;
    if (!input.lastCompletedAt) return true;
    const completedMs = Date.parse(input.lastCompletedAt);
    if (!Number.isFinite(completedMs)) return true;
    return nowMs - completedMs >= input.recoverAfterMs;
  }

  if (input.force) return true;
  if (!input.lastCompletedAt) return true;
  const completedMs = Date.parse(input.lastCompletedAt);
  if (!Number.isFinite(completedMs)) return true;
  const minIntervalMs = input.minIntervalMs ?? EBILLET_MIN_CYCLE_INTERVAL_MS;
  return nowMs - completedMs >= minIntervalMs;
}

async function enqueueEligibleOrganizers(): Promise<number> {
  // This RPC encodes the important distinction between availability and sync
  // eligibility: linked cinemas stay eligible even if is_active=false.
  const enqueueRpc = supabaseAdmin.rpc as unknown as (
    fn: "enqueue_ebillet_import_runs",
  ) => PromiseLike<QueueRpcResult>;
  const { data, error } = await enqueueRpc("enqueue_ebillet_import_runs");
  if (error) throw new Error(`eBillet queue: ${error.message}`);
  return Number(data ?? 0) || 0;
}

async function remainingRuns(): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("import_runs")
    .select("id", { count: "exact", head: true })
    .eq("source", "ebillet")
    .eq("scope_type", "organizer")
    .in("state", ["queued", "running"]);
  if (error) throw new Error(`eBillet queue count: ${error.message}`);
  return count ?? 0;
}

async function lastCompletedRunAt(): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("import_runs")
    .select("finished_at,updated_at")
    .eq("source", "ebillet")
    .eq("scope_type", "organizer")
    .eq("state", "completed")
    .order("finished_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`eBillet latest completion: ${error.message}`);
  return data?.finished_at ?? data?.updated_at ?? null;
}

const stateToStatus = (state: RunState): EbilletQueueResult["status"] =>
  state === "dead_letter" ? "dead_letter" : "retrying";

/**
 * Process at most one organizer. Call repeatedly until `done=true`.
 * A failed organizer is released for a later scheduler invocation instead of
 * being hammered repeatedly inside the same request.
 */
export async function runNextEbilletOrganizer(
  opts: EbilletQueueOptions = {},
): Promise<EbilletQueueResult> {
  await reapExpiredRuns("ebillet");

  const activeBefore = await remainingRuns();
  let queued = 0;
  if (activeBefore === 0) {
    const lastCompletedAt = await lastCompletedRunAt();
    if (
      shouldStartEbilletCycle({
        activeRuns: activeBefore,
        lastCompletedAt,
        allowStart: opts.allowStart ?? true,
        force: opts.forceQueue ?? false,
        recoverAfterMs: opts.recoverAfterMs,
      })
    ) {
      queued = await enqueueEligibleOrganizers();
    }
  }

  const run = await claimRun("ebillet");

  if (!run) {
    return {
      done: true,
      status: "idle",
      message:
        opts.allowStart === false
          ? "Ingen igangværende eBillet-kørsel at genoptage."
          : "Ingen eBillet-organizers venter på synkronisering.",
      runId: null,
      organizerId: null,
      remaining: 0,
      queued,
    };
  }

  if (run.scopeType !== "organizer" || !/^\d+$/.test(run.scopeKey)) {
    const next = await failRun(run.id, `Ugyldigt eBillet-scope: ${run.scopeType}/${run.scopeKey}`);
    return {
      done: false,
      status: stateToStatus(next),
      message: `Ugyldigt eBillet-job ${run.id} er frigivet til fejlhåndtering.`,
      runId: run.id,
      organizerId: null,
      remaining: await remainingRuns(),
      queued,
    };
  }

  const organizerId = Number(run.scopeKey);
  try {
    const result = await runOrganizerPipeline(organizerId);
    await completeRun(run.id, {
      organizerId,
      cinemaId: result.cinemaId,
      movies: result.movies,
      screenings: result.screenings,
      upserted: result.upserted,
      deleted: result.deleted,
      skipped: result.skipped,
      reason: result.reason ?? null,
      snapshotId: result.snapshotId ?? null,
    });
    const remaining = await remainingRuns();
    return {
      done: remaining === 0,
      status: "completed",
      message: result.skipped
        ? `eBillet ${organizerId} blev sprunget over: ${result.reason ?? "ikke en biograf"}.`
        : `eBillet ${organizerId}: ${result.screenings} forestillinger, ${result.movies} film; ${result.deleted} forældede forestillinger fjernet inden for samme biograf.`,
      runId: run.id,
      organizerId,
      remaining,
      queued,
      result: {
        cinemaId: result.cinemaId,
        movies: result.movies,
        screenings: result.screenings,
        upserted: result.upserted,
        deleted: result.deleted,
        skipped: result.skipped,
        reason: result.reason ?? null,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const next = await failRun(run.id, message);
    return {
      done: false,
      status: stateToStatus(next),
      message: `eBillet ${organizerId} fejlede; eksisterende data er bevaret. ${message}`,
      runId: run.id,
      organizerId,
      remaining: await remainingRuns(),
      queued,
    };
  }
}

/**
 * Work through one finite organizer cycle until the request is close to its
 * wall-clock budget. Resume-only callers drain existing work. If
 * `recoverAfterMs` is set, they may also enqueue one fresh cycle after that
 * stale threshold, but never while organizer work is already active.
 */
export async function runEbilletQueueBatch(
  budgetMs = 55_000,
  opts: EbilletQueueOptions = {},
): Promise<EbilletQueueResult & { processed: number }> {
  const deadline = Date.now() + Math.max(1_000, budgetMs);
  let processed = 0;
  let last: EbilletQueueResult | null = null;

  while (Date.now() < deadline) {
    last = await runNextEbilletOrganizer(opts);
    if (last.runId) processed += 1;
    if (last.done || last.status === "retrying" || last.status === "dead_letter") break;
  }

  if (!last) {
    last = {
      done: false,
      status: "running",
      message: "eBillet-kørslen nåede ikke at starte inden for tidsbudgettet.",
      runId: null,
      organizerId: null,
      remaining: await remainingRuns(),
      queued: 0,
    };
  }
  return { ...last, processed };
}
