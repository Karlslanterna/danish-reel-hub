/**
 * Durable eBillet driver for the canonical import pipeline.
 *
 * One `import_runs` row represents exactly one organizer. The database lease
 * prevents two workers from processing the same organizer, and an expired
 * lease makes a crashed job reclaimable on the next scheduler tick.
 *
 * This deliberately replaces `ebillet_sync_runs` as the active sync driver.
 * Discovery still lives in the legacy module for now because it is registry
 * maintenance, not canonical screening promotion.
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

async function enqueueEligibleOrganizers(): Promise<number> {
  // This RPC encodes the important distinction between availability and sync
  // eligibility: linked cinemas stay eligible even if is_active=false.
  // The generated Supabase type does not know about the migration until types
  // are regenerated, so the narrow cast is kept local and does not use `any`.
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

const stateToStatus = (state: RunState): EbilletQueueResult["status"] =>
  state === "dead_letter" ? "dead_letter" : "retrying";

/**
 * Process at most one organizer. Call repeatedly until `done=true`.
 * A failed organizer is released for a later scheduler invocation instead of
 * being hammered repeatedly inside the same request.
 */
export async function runNextEbilletOrganizer(): Promise<EbilletQueueResult> {
  await reapExpiredRuns("ebillet");
  const queued = await enqueueEligibleOrganizers();
  const run = await claimRun("ebillet");

  if (!run) {
    return {
      done: true,
      status: "idle",
      message: "Ingen eBillet-organizers venter på synkronisering.",
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
 * Work through organizers until the request is close to its wall-clock budget.
 * Stops immediately after a failure so retries happen on a later invocation.
 */
export async function runEbilletQueueBatch(
  budgetMs = 55_000,
): Promise<EbilletQueueResult & { processed: number }> {
  const deadline = Date.now() + Math.max(1_000, budgetMs);
  let processed = 0;
  let last: EbilletQueueResult | null = null;

  while (Date.now() < deadline) {
    last = await runNextEbilletOrganizer();
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
