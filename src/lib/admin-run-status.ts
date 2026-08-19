export type AdminImportRun = {
  id: string;
  source: string;
  state: string;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

export type AdminSourceRunSummary = {
  source: string;
  latestSuccessAt: string | null;
  latestState: string | null;
  queued: number;
  running: number;
  failedSinceSuccess: number;
  staleActiveRuns: number;
  status: "healthy" | "warning" | "critical";
};

const ACTIVE_STATES = new Set(["queued", "running"]);

const timestamp = (value: string | null | undefined): number =>
  value ? new Date(value).getTime() : Number.NEGATIVE_INFINITY;

/**
 * A completed full-source run supersedes older queue residue. Historical queue
 * rows remain useful audit history, but must not make the current dashboard
 * look unhealthy after a newer import has completed successfully.
 */
export function isSupersededActiveRun(
  run: Pick<AdminImportRun, "state" | "created_at">,
  latestSuccessAt: string | null,
): boolean {
  return (
    ACTIVE_STATES.has(run.state) &&
    latestSuccessAt !== null &&
    timestamp(run.created_at) <= timestamp(latestSuccessAt)
  );
}

export function summarizeAdminSourceRuns(
  runs: AdminImportRun[],
  source: string,
  now = new Date(),
): AdminSourceRunSummary {
  const sourceRuns = runs
    .filter((run) => run.source === source)
    .sort((a, b) => timestamp(b.created_at) - timestamp(a.created_at));
  const latestSuccess = sourceRuns.find(
    (run) => run.state === "completed" && Boolean(run.finished_at),
  );
  const latestSuccessAt = latestSuccess?.finished_at ?? null;
  const activeRuns = sourceRuns.filter(
    (run) => ACTIVE_STATES.has(run.state) && !isSupersededActiveRun(run, latestSuccessAt),
  );
  const failedSinceSuccess = sourceRuns.filter(
    (run) =>
      ["failed", "dead_letter"].includes(run.state) &&
      (!latestSuccessAt || timestamp(run.created_at) > timestamp(latestSuccessAt)),
  ).length;
  const ageHours = latestSuccessAt
    ? (now.getTime() - timestamp(latestSuccessAt)) / 3_600_000
    : Number.POSITIVE_INFINITY;
  const staleActiveRuns = activeRuns.filter(
    (run) => now.getTime() - timestamp(run.updated_at || run.created_at) > 30 * 60_000,
  ).length;
  const queued = activeRuns.filter((run) => run.state === "queued").length;
  const running = activeRuns.filter((run) => run.state === "running").length;
  const status: AdminSourceRunSummary["status"] =
    failedSinceSuccess > 0 || ageHours > 48
      ? "critical"
      : queued > 0 || running > 0 || ageHours > 30
        ? "warning"
        : "healthy";

  return {
    source,
    latestSuccessAt,
    latestState: sourceRuns[0]?.state ?? null,
    queued,
    running,
    failedSinceSuccess,
    staleActiveRuns,
    status,
  };
}
