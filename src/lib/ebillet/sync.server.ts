/**
 * Compatibility facade for the former eBillet sync module.
 *
 * IMPORTANT: this file no longer contains an importer and never writes the
 * legacy `showtimes` table. Canonical synchronization is exclusively:
 *
 *   runner.server.ts -> pipeline.server.ts -> staged_screenings -> screenings
 *
 * Organizer discovery is registry maintenance and lives in discovery.server.ts.
 * The exports below remain temporarily so older admin/scheduler call sites do
 * not break while the migration settles.
 */

export {
  DEFAULT_MAX_ORGANIZER_ID,
  discoverOrganizers,
  type DiscoveredOrganizer,
} from "./discovery.server";

export type OrganizerSyncCounts = {
  cinemas: number;
  movies: number;
  showtimes: number;
};

export type SyncRunSummary = {
  runId: string;
  kind: "discover" | "sync";
  status: "running" | "completed" | "failed";
  organizersFound: number;
  organizersActive: number;
  organizersSynced: number;
  organizersFailed: number;
  cinemas: number;
  movies: number;
  showtimes: number;
  errors: string[];
  message: string | null;
  done: boolean;
};

/**
 * @deprecated Use runOrganizerPipeline directly. Kept only for source
 * compatibility; this delegates to the canonical snapshot/staging pipeline.
 */
export async function syncOrganizer(organizerId: number): Promise<OrganizerSyncCounts> {
  const { runOrganizerPipeline } = await import("./pipeline.server");
  const result = await runOrganizerPipeline(organizerId);
  return {
    cinemas: result.skipped ? 0 : 1,
    movies: result.movies,
    showtimes: result.screenings,
  };
}

/**
 * @deprecated Discovery now has its own service and canonical sync uses
 * import_runs. This wrapper preserves the old API without reviving the old
 * direct-write state machine.
 */
export async function runEbilletJob(opts: {
  kind: "discover" | "sync";
  trigger?: string;
  budgetMs?: number;
  maxId?: number;
}): Promise<SyncRunSummary> {
  if (opts.kind === "discover") {
    const { runEbilletDiscoveryJob } = await import("./discovery.server");
    return runEbilletDiscoveryJob({
      trigger: opts.trigger,
      budgetMs: opts.budgetMs,
      maxId: opts.maxId,
    });
  }

  const { runNextEbilletOrganizer } = await import("./runner.server");
  const result = await runNextEbilletOrganizer();
  const failed = result.status === "retrying" || result.status === "dead_letter";
  return {
    runId: result.runId ?? "none",
    kind: "sync",
    status: failed ? "failed" : result.done ? "completed" : "running",
    organizersFound: 0,
    organizersActive: result.remaining + (result.organizerId ? 1 : 0),
    organizersSynced: result.result && !result.result.skipped ? 1 : 0,
    organizersFailed: failed ? 1 : 0,
    cinemas: result.result && !result.result.skipped ? 1 : 0,
    movies: result.result?.movies ?? 0,
    showtimes: result.result?.screenings ?? 0,
    errors: failed ? [result.message] : [],
    message: result.message,
    done: result.done,
  };
}

/**
 * @deprecated Canonical jobs recover through import_runs leases. This wrapper
 * now reaps expired canonical eBillet leases rather than touching legacy sync
 * rows.
 */
export async function reapStaleEbilletRuns(): Promise<number> {
  const { reapExpiredRuns } = await import("@/lib/pipeline/runs.server");
  return reapExpiredRuns("ebillet");
}
