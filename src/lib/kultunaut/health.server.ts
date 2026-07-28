/**
 * Import health monitoring for the Kultunaut pipeline.
 *
 * Reads from `import_jobs` and computes a Healthy / Warning / Critical
 * status based on freshness, throughput, duration, and consecutive
 * failures. Every state transition is appended to `import_health_events`.
 *
 * This module never mutates `import_jobs` and never changes import logic.
 */

export type HealthStatus = "healthy" | "warning" | "critical" | "unknown";

export type ImportMetrics = {
  lastSuccessAt: string | null;
  hoursSinceLastSuccess: number | null;
  lastJobId: string | null;
  lastJobStatus: string | null;
  lastDurationSeconds: number | null;
  lastMovies: number;
  lastCinemas: number;
  lastShowtimes: number;
  avgMovies: number;
  avgCinemas: number;
  avgShowtimes: number;
  avgDurationSeconds: number;
  consecutiveFailures: number;
  failedLast24h: number;
};

export type HealthReport = {
  status: HealthStatus;
  reasons: string[];
  metrics: ImportMetrics;
  checkedAt: string;
  transitioned: boolean;
  previousStatus: HealthStatus | null;
};

/** Thresholds — tune here without touching import logic. */
export const THRESHOLDS = {
  freshnessWarnHours: 26, // daily import expected → warn after 26h
  freshnessCriticalHours: 48,
  durationWarnMultiplier: 1.5, // vs recent average
  durationCriticalMultiplier: 3,
  durationAbsoluteWarnSeconds: 20 * 60,
  durationAbsoluteCriticalSeconds: 60 * 60,
  dropWarnRatio: 0.5, // >50% drop vs recent avg
  dropCriticalRatio: 0.8,
  consecutiveFailuresWarn: 1,
  consecutiveFailuresCritical: 2,
  recentSampleSize: 5,
};

type JobRow = {
  id: string;
  status: string;
  processed_movies: number;
  processed_cinemas: number;
  processed_showtimes: number;
  total_movies: number;
  total_cinemas: number;
  total_showtimes: number;
  created_at: string;
  updated_at: string;
};

const durationSeconds = (j: JobRow): number =>
  Math.max(0, (new Date(j.updated_at).getTime() - new Date(j.created_at).getTime()) / 1000);

const avg = (nums: number[]): number =>
  nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;

async function loadJobs() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("import_jobs")
    .select(
      "id,status,processed_movies,processed_cinemas,processed_showtimes,total_movies,total_cinemas,total_showtimes,created_at,updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(`Failed to load import jobs: ${error.message}`);
  return (data ?? []) as JobRow[];
}

function computeMetrics(jobs: JobRow[]): ImportMetrics {
  const last = jobs[0] ?? null;
  const successes = jobs.filter((j) => j.status === "completed");
  const recentSuccesses = successes.slice(0, THRESHOLDS.recentSampleSize);
  const lastSuccess = successes[0] ?? null;

  // Consecutive failures walking from newest job backwards.
  let consecutiveFailures = 0;
  for (const j of jobs) {
    if (j.status === "failed") consecutiveFailures++;
    else if (j.status === "completed") break;
    // running/queued jobs are skipped from the streak calculation
  }

  const nowMs = Date.now();
  const failedLast24h = jobs.filter(
    (j) =>
      j.status === "failed" &&
      nowMs - new Date(j.updated_at).getTime() < 24 * 60 * 60 * 1000,
  ).length;

  return {
    lastSuccessAt: lastSuccess?.updated_at ?? null,
    hoursSinceLastSuccess: lastSuccess
      ? (nowMs - new Date(lastSuccess.updated_at).getTime()) / 3_600_000
      : null,
    lastJobId: last?.id ?? null,
    lastJobStatus: last?.status ?? null,
    lastDurationSeconds: last ? durationSeconds(last) : null,
    lastMovies: last?.processed_movies ?? 0,
    lastCinemas: last?.processed_cinemas ?? 0,
    lastShowtimes: last?.processed_showtimes ?? 0,
    avgMovies: Math.round(avg(recentSuccesses.map((j) => j.processed_movies))),
    avgCinemas: Math.round(avg(recentSuccesses.map((j) => j.processed_cinemas))),
    avgShowtimes: Math.round(avg(recentSuccesses.map((j) => j.processed_showtimes))),
    avgDurationSeconds: Math.round(avg(recentSuccesses.map(durationSeconds))),
    consecutiveFailures,
    failedLast24h,
  };
}

function classify(m: ImportMetrics): { status: HealthStatus; reasons: string[] } {
  const reasons: string[] = [];
  let level: 0 | 1 | 2 = 0; // 0 healthy, 1 warning, 2 critical
  const bump = (l: 1 | 2, reason: string) => {
    reasons.push(reason);
    if (l > level) level = l as 0 | 1 | 2;
  };


  if (m.lastJobId === null) {
    return { status: "unknown", reasons: ["No import jobs on record"] };
  }

  // Freshness
  if (m.hoursSinceLastSuccess === null) {
    bump(2, "No successful import on record");
  } else if (m.hoursSinceLastSuccess >= THRESHOLDS.freshnessCriticalHours) {
    bump(2, `Last success was ${m.hoursSinceLastSuccess.toFixed(1)}h ago`);
  } else if (m.hoursSinceLastSuccess >= THRESHOLDS.freshnessWarnHours) {
    bump(1, `Last success was ${m.hoursSinceLastSuccess.toFixed(1)}h ago`);
  }

  // Consecutive failures
  if (m.consecutiveFailures >= THRESHOLDS.consecutiveFailuresCritical) {
    bump(2, `${m.consecutiveFailures} consecutive failed imports`);
  } else if (m.consecutiveFailures >= THRESHOLDS.consecutiveFailuresWarn) {
    bump(1, `${m.consecutiveFailures} consecutive failed import`);
  }

  // Only anomaly-check the last job if it actually completed.
  if (m.lastJobStatus === "completed") {
    if (m.lastMovies === 0) bump(2, "Latest import produced zero movies");
    if (m.lastCinemas === 0) bump(2, "Latest import produced zero cinemas");
    if (m.lastShowtimes === 0) bump(2, "Latest import produced zero showtimes");

    const checkDrop = (label: string, last: number, average: number) => {
      if (average <= 0) return;
      const ratio = 1 - last / average;
      if (ratio >= THRESHOLDS.dropCriticalRatio) {
        bump(2, `${label} dropped ${(ratio * 100).toFixed(0)}% vs recent average`);
      } else if (ratio >= THRESHOLDS.dropWarnRatio) {
        bump(1, `${label} dropped ${(ratio * 100).toFixed(0)}% vs recent average`);
      }
    };
    checkDrop("Movie count", m.lastMovies, m.avgMovies);
    checkDrop("Cinema count", m.lastCinemas, m.avgCinemas);
    checkDrop("Showtime count", m.lastShowtimes, m.avgShowtimes);

    if (m.lastDurationSeconds !== null) {
      const baseline = m.avgDurationSeconds || 0;
      if (
        m.lastDurationSeconds >= THRESHOLDS.durationAbsoluteCriticalSeconds ||
        (baseline > 0 &&
          m.lastDurationSeconds >= baseline * THRESHOLDS.durationCriticalMultiplier)
      ) {
        bump(2, `Import took ${Math.round(m.lastDurationSeconds)}s (avg ${baseline}s)`);
      } else if (
        m.lastDurationSeconds >= THRESHOLDS.durationAbsoluteWarnSeconds ||
        (baseline > 0 &&
          m.lastDurationSeconds >= baseline * THRESHOLDS.durationWarnMultiplier)
      ) {
        bump(1, `Import took ${Math.round(m.lastDurationSeconds)}s (avg ${baseline}s)`);
      }
    }
  }

  const lvl = level as number;
  const status: HealthStatus = lvl === 2 ? "critical" : lvl === 1 ? "warning" : "healthy";

  if (reasons.length === 0) reasons.push("All checks passed");
  return { status, reasons };
}

async function readPreviousStatus(): Promise<HealthStatus | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("import_health_events")
    .select("status")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.status as HealthStatus | undefined) ?? null;
}

async function recordTransition(
  status: HealthStatus,
  previous: HealthStatus | null,
  reasons: string[],
  metrics: ImportMetrics,
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.from("import_health_events").insert({
    status,
    previous_status: previous,
    reasons,
    job_id: metrics.lastJobId,
    metrics: JSON.parse(JSON.stringify(metrics)),
  });
  if (error) {
    console.error("[import-health] Failed to log transition:", error.message);
    return;
  }
  console.log(
    `[import-health] state ${previous ?? "none"} → ${status}: ${reasons.join("; ")}`,
  );
}

/**
 * Compute the current import health report. When the computed status
 * differs from the last recorded status, appends a row to
 * `import_health_events` and logs the transition.
 */
export async function getImportHealth(): Promise<HealthReport> {
  const jobs = await loadJobs();
  const metrics = computeMetrics(jobs);
  const { status, reasons } = classify(metrics);
  const previousStatus = await readPreviousStatus();
  const transitioned = previousStatus !== status;
  if (transitioned) {
    await recordTransition(status, previousStatus, reasons, metrics);
  }
  return {
    status,
    reasons,
    metrics,
    checkedAt: new Date().toISOString(),
    transitioned,
    previousStatus,
  };
}
