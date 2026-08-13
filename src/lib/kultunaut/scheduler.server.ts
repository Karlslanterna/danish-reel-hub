/**
 * Scheduler for fully automated daily Kultunaut imports.
 *
 * This module ONLY orchestrates the existing import pipeline
 * (createImportJob / processJobBatch in ./import.server) — it never
 * changes import logic. Every scheduled run is recorded in
 * `import_schedule_runs` with start time, finish time, duration, final
 * status and, when relevant, the reason it failed or was skipped.
 *
 * Concurrency: the `import_schedule_runs_single_running` unique partial
 * index guarantees at most one row with status='running'. A second
 * trigger while a run is in flight resumes that run instead of starting
 * a new one, and a trigger while a manual import job is queued/running
 * is skipped with a logged reason.
 */

export type ScheduleRunResult = {
  runId: string | null;
  status: "completed" | "failed" | "skipped" | "running";
  reason: string | null;
  jobId: string | null;
  attempts: number;
  startedAt: string | null;
  finishedAt: string | null;
  durationSeconds: number | null;
  health?: { status: string; reasons: string[] } | undefined;
};

/** Max wall-clock time spent draining batches inside one invocation. */
const WALL_CLOCK_BUDGET_MS = 120_000;
/** Retry policy for transient failures (feed fetch + batch processing). */
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function log(event: string, ctx: Record<string, unknown> = {}) {
  console.log(
    JSON.stringify({ level: "info", scope: "import-scheduler", event, ...ctx }),
  );
}

function logError(event: string, ctx: Record<string, unknown> = {}) {
  console.error(
    JSON.stringify({ level: "error", scope: "import-scheduler", event, ...ctx }),
  );
}

/** Default Kultunaut feed when no override is configured. */
const DEFAULT_FEED_URL = "https://kultunaut.dk/perl/export/kalorius.xml";
/** Kultunaut requires this exact User-Agent for access (server-side only). */
const KULTUNAUT_USER_AGENT = "KarlVictor";

/** Error carrying the HTTP status of a denied Kultunaut response. */
class FeedAccessError extends Error {
  status: number;
  constructor(status: number, snippet: string) {
    super(
      `Kultunaut nægtede adgang (HTTP ${status}). ` +
        (snippet ? `Svar fra Kultunaut: ${snippet}` : "") +
        " Kontrollér at Kultunaut har godkendt vores User-Agent og IP-adresse.",
    );
    this.status = status;
    this.name = "FeedAccessError";
  }
}

/** Fetch the Kultunaut feed with exponential-backoff retries. */
async function fetchFeedXml(): Promise<string> {
  const feedUrl = process.env.KULTUNAUT_FEED_URL || DEFAULT_FEED_URL;
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(feedUrl, {
        headers: {
          accept: "application/xml,text/xml",
          // Kultunaut whitelists this agent string; must be sent server-side.
          "user-agent": KULTUNAUT_USER_AGENT,
        },
      });
      if (res.status === 401 || res.status === 403) {
        const body = (await res.text().catch(() => "")).replace(/<[^>]*>/g, " ");
        const snippet = body.replace(/\s+/g, " ").trim().slice(0, 200);
        logError("feed_access_denied", { attempt, status: res.status, snippet });
        // Access denial is not transient — fail immediately, no retries.
        throw new FeedAccessError(res.status, snippet);
      }
      if (!res.ok) throw new Error(`Feed responded ${res.status}`);
      const xml = await res.text();
      if (!xml.trim()) throw new Error("Feed returned an empty body");
      log("feed_fetched", { attempt, bytes: xml.length });
      return xml;
    } catch (err) {
      if (err instanceof FeedAccessError) throw err;
      lastError = err instanceof Error ? err.message : String(err);
      logError("feed_fetch_failed", { attempt, error: lastError });
      if (attempt < MAX_ATTEMPTS) await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
    }
  }
  throw new Error(`Feed fetch failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
}


/** One batch with retries; returns the pipeline result. */
async function processBatchWithRetry(jobId: string) {
  const { processJobBatch } = await import("@/lib/kultunaut/import.server");
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await processJobBatch(jobId);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      logError("batch_failed", { jobId, attempt, error: lastError });
      if (attempt < MAX_ATTEMPTS) await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
    }
  }
  throw new Error(`Batch processing failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
}

async function finishRun(
  runId: string,
  status: "completed" | "failed",
  reason: string | null,
  attempts: number,
  startedAtMs: number,
): Promise<ScheduleRunResult> {
  const finishedAt = new Date();
  const durationSeconds = (finishedAt.getTime() - startedAtMs) / 1000;
  const db = await admin();
  await db
    .from("import_schedule_runs")
    .update({
      status,
      reason,
      attempts,
      finished_at: finishedAt.toISOString(),
      duration_seconds: durationSeconds,
    })
    .eq("id", runId);

  log("run_finished", { runId, status, reason, durationSeconds });

  // Reuse the existing health monitor so import-health reflects this run.
  let health: { status: string; reasons: string[] } | undefined;
  try {
    const { getImportHealth } = await import("@/lib/kultunaut/health.server");
    const report = await getImportHealth();
    health = { status: report.status, reasons: report.reasons };
  } catch (err) {
    logError("health_refresh_failed", {
      runId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    runId,
    status,
    reason,
    jobId: null,
    attempts,
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationSeconds,
    health,
  };
}

/** True when a manual/admin import job is still in flight. */
async function activeImportJob(): Promise<string | null> {
  const db = await admin();
  // Only jobs touched in the last 2 hours count as "in flight" — an older
  // queued/running row is abandoned and must not block the daily import.
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data } = await db
    .from("import_jobs")
    .select("id,status,updated_at")
    .in("status", ["queued", "running"])
    .gte("updated_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * Entry point for the daily scheduler. Idempotent and safe to call
 * repeatedly: it resumes an in-flight run, skips when another import is
 * active, and otherwise creates + drains a fresh import job.
 */
export async function runScheduledImport(
  trigger: "cron" | "manual" | "resume" = "cron",
  resumeOnly = false,
): Promise<ScheduleRunResult> {
  const db = await admin();

  // 1. Resume an in-flight scheduled run (previous invocation ran out of budget).
  const { data: inFlight } = await db
    .from("import_schedule_runs")
    .select("id,job_id,attempts,started_at")
    .eq("status", "running")
    .maybeSingle();

  if (inFlight) {
    const startedAtMs = new Date(inFlight.started_at as string).getTime();
    const staleHours = (Date.now() - startedAtMs) / 3_600_000;
    if (staleHours > 6) {
      log("run_stale_failed", { runId: inFlight.id, staleHours });
      return finishRun(
        inFlight.id as string,
        "failed",
        `Run abandoned: still running after ${staleHours.toFixed(1)}h`,
        (inFlight.attempts as number) ?? 0,
        startedAtMs,
      );
    }
    if (!inFlight.job_id) {
      log("run_skipped", { reason: "another scheduled run is starting" });
      return {
        runId: inFlight.id as string,
        status: "skipped",
        reason: "A scheduled run is already in progress",
        jobId: null,
        attempts: 0,
        startedAt: inFlight.started_at as string,
        finishedAt: null,
        durationSeconds: null,
      };
    }
    log("run_resumed", { runId: inFlight.id, jobId: inFlight.job_id });
    return drain(
      inFlight.id as string,
      inFlight.job_id as string,
      startedAtMs,
      (inFlight.attempts as number) ?? 0,
    );
  }

  // 1b. Resume-only triggers never start a new import.
  if (resumeOnly) {
    log("run_skipped", { reason: "resume trigger with no run in progress" });
    return {
      runId: null,
      status: "skipped",
      reason: "No scheduled run in progress to resume",
      jobId: null,
      attempts: 0,
      startedAt: null,
      finishedAt: null,
      durationSeconds: null,
    };
  }

  // 2. Skip when a manual import is in flight — never overlap.
  const activeJob = await activeImportJob();
  if (activeJob) {
    const reason = `Skipped: import job ${activeJob} is still queued/running`;
    log("run_skipped", { reason, jobId: activeJob });
    await db.from("import_schedule_runs").insert({
      status: "skipped",
      trigger,
      job_id: activeJob,
      reason,
      finished_at: new Date().toISOString(),
      duration_seconds: 0,
    });
    return {
      runId: null,
      status: "skipped",
      reason,
      jobId: activeJob,
      attempts: 0,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationSeconds: 0,
    };
  }

  // 3. Claim a new run. The unique partial index rejects a second claim.
  const startedAtMs = Date.now();
  const { data: run, error: claimError } = await db
    .from("import_schedule_runs")
    .insert({ status: "running", trigger })
    .select("id")
    .single();

  if (claimError || !run) {
    const reason = `Could not claim a scheduled run: ${claimError?.message ?? "unknown"}`;
    log("run_skipped", { reason });
    return {
      runId: null,
      status: "skipped",
      reason,
      jobId: null,
      attempts: 0,
      startedAt: null,
      finishedAt: null,
      durationSeconds: null,
    };
  }

  const runId = run.id as string;
  log("run_started", { runId, trigger, startedAt: new Date(startedAtMs).toISOString() });

  // 4. Fetch feed + create the job (existing pipeline, unchanged).
  let jobId: string;
  try {
    const xml = await fetchFeedXml();
    const { createImportJob } = await import("@/lib/kultunaut/import.server");
    ({ jobId } = await createImportJob(xml));
    await db.from("import_schedule_runs").update({ job_id: jobId }).eq("id", runId);
    log("job_created", { runId, jobId });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return finishRun(runId, "failed", reason, MAX_ATTEMPTS, startedAtMs);
  }

  return drain(runId, jobId, startedAtMs, 0);
}

/** Drive processJobBatch until the job finishes or the budget runs out. */
async function drain(
  runId: string,
  jobId: string,
  startedAtMs: number,
  attempts: number,
): Promise<ScheduleRunResult> {
  const db = await admin();
  const deadline = Date.now() + WALL_CLOCK_BUDGET_MS;
  let batches = attempts;

  while (Date.now() < deadline) {
    let result: Awaited<ReturnType<typeof processBatchWithRetry>>;
    try {
      result = await processBatchWithRetry(jobId);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return finishRun(runId, "failed", reason, batches, startedAtMs);
    }
    batches++;

    const status = (result as { status?: string }).status;
    const done = (result as { done?: boolean }).done;
    if (status === "failed") {
      const message =
        (result as { message?: string | null }).message ?? "Import job reported failure";
      return finishRun(runId, "failed", message, batches, startedAtMs);
    }
    if (done || status === "completed") {
      const finished = await finishRun(runId, "completed", null, batches, startedAtMs);
      return { ...finished, jobId };
    }
  }

  // Out of budget — leave the run 'running' so the next trigger resumes it.
  await db.from("import_schedule_runs").update({ attempts: batches }).eq("id", runId);
  log("run_paused", { runId, jobId, batches, reason: "wall-clock budget reached" });
  return {
    runId,
    status: "running",
    reason: "Budget reached — will resume on next scheduled trigger",
    jobId,
    attempts: batches,
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: null,
    durationSeconds: (Date.now() - startedAtMs) / 1000,
  };
}

export type SchedulerHealth = {
  status: "healthy" | "warning" | "critical" | "unknown";
  reasons: string[];
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastSuccessAt: string | null;
  hoursSinceLastSuccess: number | null;
};

/**
 * Scheduler-side health, surfaced by /api/public/import-health so a
 * scheduler that never fires (or keeps failing) is detectable.
 */
export async function getSchedulerHealth(): Promise<SchedulerHealth> {
  const db = await admin();
  const { data, error } = await db
    .from("import_schedule_runs")
    .select("status,started_at,finished_at,reason")
    .order("started_at", { ascending: false })
    .limit(20);

  if (error) {
    return {
      status: "unknown",
      reasons: [`Failed to read scheduler runs: ${error.message}`],
      lastRunAt: null,
      lastRunStatus: null,
      lastSuccessAt: null,
      hoursSinceLastSuccess: null,
    };
  }

  const runs = data ?? [];
  if (runs.length === 0) {
    return {
      status: "unknown",
      reasons: ["Scheduler has never run"],
      lastRunAt: null,
      lastRunStatus: null,
      lastSuccessAt: null,
      hoursSinceLastSuccess: null,
    };
  }

  const last = runs[0]!;
  const lastSuccess = runs.find((r) => r.status === "completed") ?? null;
  const hoursSinceLastSuccess = lastSuccess?.finished_at
    ? (Date.now() - new Date(lastSuccess.finished_at as string).getTime()) / 3_600_000
    : null;

  const reasons: string[] = [];
  let level: number = 0;
  const bump = (l: 1 | 2, reason: string) => {
    reasons.push(reason);
    if (l > level) level = l;
  };

  if (hoursSinceLastSuccess === null) {
    bump(2, "Scheduler has no successful run on record");
  } else if (hoursSinceLastSuccess >= 48) {
    bump(2, `Last scheduled import succeeded ${hoursSinceLastSuccess.toFixed(1)}h ago`);
  } else if (hoursSinceLastSuccess >= 26) {
    bump(1, `Last scheduled import succeeded ${hoursSinceLastSuccess.toFixed(1)}h ago`);
  }

  if (last.status === "failed") {
    bump(1, `Last scheduled run failed: ${last.reason ?? "unknown reason"}`);
  }

  const consecutiveFailures = (() => {
    let n = 0;
    for (const r of runs) {
      if (r.status === "failed") n++;
      else if (r.status === "completed") break;
    }
    return n;
  })();
  if (consecutiveFailures >= 2) {
    bump(2, `${consecutiveFailures} consecutive failed scheduled runs`);
  }

  if (reasons.length === 0) reasons.push("Scheduler healthy");

  return {
    status: level === 2 ? "critical" : level === 1 ? "warning" : "healthy",
    reasons,
    lastRunAt: (last.started_at as string) ?? null,
    lastRunStatus: (last.status as string) ?? null,
    lastSuccessAt: (lastSuccess?.finished_at as string | undefined) ?? null,
    hoursSinceLastSuccess,
  };
}

/**
 * Verify the cron trigger token against `public.scheduler_secrets`.
 * The token is generated inside Postgres and is readable only by
 * service_role, so it never leaves the backend. Compared in constant time.
 */
export async function verifySchedulerToken(token: string | null): Promise<boolean> {
  if (!token) return false;
  const db = await admin();
  const { data, error } = await db
    .from("scheduler_secrets")
    .select("value")
    .eq("name", "kultunaut_cron")
    .maybeSingle();
  if (error || !data?.value) {
    logError("token_lookup_failed", { error: error?.message ?? "token missing" });
    return false;
  }
  const expected = data.value as string;
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}
