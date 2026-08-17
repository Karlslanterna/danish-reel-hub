/**
 * Kultunaut canonical import pipeline.
 *
 *   snapshot -> validate -> resolve identities -> normalize -> stage -> promote
 *
 * Kultunaut owns screenings only for cinemas without an eBillet link. Identity
 * resolution is persistent and conservative: source refs are reused, movies
 * are never merged by title alone, and one unresolved movie blocks promotion
 * for that cinema instead of silently deleting the missing screening.
 *
 * `import_jobs` remains a temporary Admin compatibility read model. Durable
 * execution state lives in `import_runs`.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { parseKultunautXml } from "./parser.server";
import { validateKultunautSnapshot } from "./snapshot";
import { normalizeKultunautScreenings } from "./normalize";
import { loadEbilletOwnedCinemaIds } from "./authority.server";
import {
  resolveKultunautCinemas,
  resolveKultunautMovies,
} from "./resolve.server";
import {
  applyValidation,
  createSnapshot,
  getSnapshotRaw,
  loadStagedForCinema,
  markSnapshotFailed,
  stageScreenings,
  stagedCinemaRefs,
} from "@/lib/pipeline/snapshots.server";
import { promoteCinema, purgePastScreenings } from "@/lib/pipeline/promote.server";
import { loadRefs, recordUnresolved } from "@/lib/pipeline/identity.server";
import { toPromotionRow } from "@/lib/pipeline/types";
import {
  attachSnapshot,
  checkpoint,
  completeRun,
  createRun,
  failRun,
  getRun,
} from "@/lib/pipeline/runs.server";

const SOURCE = "kultunaut" as const;
const CINEMAS_PER_BATCH = 8;

export type BatchResult = {
  done: boolean;
  status: "queued" | "running" | "completed" | "failed";
  phase: string;
  message?: string;
};

type PipelineCursor = {
  phase?: "parse" | "promote";
  index?: number;
  scopes?: string[];
  blockedMovieRefs?: string[];
  declaredEmpty?: boolean;
};

// ------------------------------------------------------------------- legacy Admin compatibility

/**
 * Register a full feed snapshot and durable run. The legacy job id is returned
 * because current Admin routes still address imports by import_jobs.id.
 */
export async function createImportJob(
  xml: string,
  opts: { declaredEmpty?: boolean } = {},
): Promise<{ jobId: string; runId: string; snapshotId: string }> {
  const snapshot = await createSnapshot({
    source: SOURCE,
    scopeType: "feed",
    scopeExternalId: "kultunaut-feed",
    payload: xml,
    storeRaw: true,
  });
  const run = await createRun({
    source: SOURCE,
    scopeType: "feed",
    scopeKey: `feed:${snapshot.id}`,
    snapshotId: snapshot.id,
    cursor: { phase: "parse", declaredEmpty: opts.declaredEmpty === true },
  });
  const { data, error } = await supabaseAdmin
    .from("import_jobs")
    .insert({
      source: SOURCE,
      status: "queued",
      phase: "pending",
      xml,
      payload: { run_id: run.id, snapshot_id: snapshot.id },
      message: "Snapshot modtaget",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`import job: create failed — ${error?.message}`);
  return { jobId: data.id, runId: run.id, snapshotId: snapshot.id };
}

async function jobContext(jobId: string) {
  const { data, error } = await supabaseAdmin
    .from("import_jobs")
    .select("id,status,phase,payload")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(`import job read: ${error.message}`);
  if (!data) throw new Error("Job not found");
  const payload = (data.payload ?? {}) as { run_id?: string; snapshot_id?: string };
  if (!payload.run_id || !payload.snapshot_id) {
    throw new Error("Job blev oprettet af den gamle importer og kan ikke genoptages her");
  }
  return {
    jobId,
    runId: payload.run_id,
    snapshotId: payload.snapshot_id,
  };
}

async function mirrorJob(jobId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin
    .from("import_jobs")
    .update(patch as never)
    .eq("id", jobId);
  if (error) console.error(`[kultunaut] legacy job mirror failed ${jobId}: ${error.message}`);
}

// ------------------------------------------------------------------- parse/resolve/stage

async function runParsePhase(ctx: {
  jobId: string;
  runId: string;
  snapshotId: string;
  declaredEmpty: boolean;
}): Promise<BatchResult> {
  const xml = (await getSnapshotRaw(ctx.snapshotId)) ?? "";
  const parsed = parseKultunautXml(xml);
  const normalized = normalizeKultunautScreenings(parsed.showtimes);

  const validation = validateKultunautSnapshot({
    xmlLength: xml.length,
    movies: parsed.movies.size,
    cinemas: parsed.cinemas.size,
    showtimes: parsed.showtimes.length,
    grouped: normalized.length,
    declaredEmpty: ctx.declaredEmpty,
  });
  const promotable = await applyValidation(ctx.snapshotId, {
    verdict: validation.verdict,
    reasons: validation.reasons,
    stats: {
      xmlLength: xml.length,
      movies: parsed.movies.size,
      cinemas: parsed.cinemas.size,
      sourceShowtimeGroups: parsed.showtimes.length,
      physicalScreenings: normalized.length,
    },
  });

  if (!promotable) {
    const reason = validation.reasons.join("; ") || "Snapshot afvist";
    await mirrorJob(ctx.jobId, {
      status: "failed",
      phase: "parse",
      message: `Snapshot afvist: ${reason}`,
    });
    const state = await failRun(ctx.runId, `snapshot incomplete: ${reason}`);
    if (state === "dead_letter") await markSnapshotFailed(ctx.snapshotId, reason);
    return { done: true, status: "failed", phase: "parse", message: reason };
  }

  // Resolve external identities before any screening can promote. Existing
  // source refs are authoritative; eBillet-owned cinemas are never mutated.
  const [cinemaResolution, movieResolution] = await Promise.all([
    resolveKultunautCinemas(parsed.cinemas.values()),
    resolveKultunautMovies(parsed.movies.values()),
  ]);

  // Staging contains the complete normalized source snapshot, including rows
  // whose movie identity may currently require review. Promotion checks those
  // blockers per cinema so no partial desired set can delete live screenings.
  await stageScreenings(ctx.snapshotId, SOURCE, normalized);

  const scopes = [...new Set(normalized.map((screening) => screening.sourceCinemaRef))].sort();
  const blockedMovieRefs = [...new Set(movieResolution.unresolvedExternalIds)].sort();
  const stats = {
    movies: parsed.movies.size,
    movieCanonicalsWritten: movieResolution.canonicalRowsWritten,
    cinemas: parsed.cinemas.size,
    cinemaCanonicalsWritten: cinemaResolution.canonicalRowsWritten,
    skippedEbilletCinemas: cinemaResolution.skippedEbilletOwned,
    screenings: normalized.length,
    unresolvedMovies: blockedMovieRefs.length,
  };

  await checkpoint(
    ctx.runId,
    { phase: "promote", index: 0, scopes, blockedMovieRefs },
    stats,
  );
  await mirrorJob(ctx.jobId, {
    status: "running",
    phase: "promote",
    total_movies: parsed.movies.size,
    total_cinemas: parsed.cinemas.size,
    total_showtimes: normalized.length,
    processed_movies: parsed.movies.size,
    processed_cinemas: cinemaResolution.canonicalRowsWritten,
    message:
      blockedMovieRefs.length > 0
        ? `Normaliseret; ${blockedMovieRefs.length} filmidentiteter kræver kontrol`
        : "Normaliseret — klar til promovering",
  });
  return { done: false, status: "running", phase: "promote" };
}

// ------------------------------------------------------------------- scoped promotion

async function runPromotePhase(
  ctx: { jobId: string; runId: string; snapshotId: string },
  cursor: { index: number; scopes: string[]; blockedMovieRefs: string[] },
): Promise<BatchResult> {
  const batch = cursor.scopes.slice(cursor.index, cursor.index + CINEMAS_PER_BATCH);
  if (batch.length === 0) return finishRun(ctx, cursor.scopes.length);

  const cinemaRefs = await loadRefs(SOURCE, "cinema", batch);
  const ebilletOwned = await loadEbilletOwnedCinemaIds();
  const blockedMovies = new Set(cursor.blockedMovieRefs);
  const unresolvedCinemas: string[] = [];
  const blockedCinemas: string[] = [];
  let upserted = 0;
  let deleted = 0;
  let skippedEbillet = 0;

  for (const scope of batch) {
    const cinemaRef = cinemaRefs.get(scope);
    if (!cinemaRef) {
      unresolvedCinemas.push(scope);
      continue;
    }
    if (ebilletOwned.has(cinemaRef.canonicalId)) {
      skippedEbillet += 1;
      continue;
    }

    const staged = await loadStagedForCinema(ctx.snapshotId, scope);
    const sourceMovieRefs = [...new Set(staged.map((screening) => screening.sourceMovieRef))];
    const movieRefs = await loadRefs(SOURCE, "movie", sourceMovieRefs);
    const missingRefs = sourceMovieRefs.filter(
      (externalId) => !movieRefs.has(externalId) || blockedMovies.has(externalId),
    );

    if (missingRefs.length > 0) {
      blockedCinemas.push(scope);
      await recordUnresolved(
        missingRefs.map((externalId) => ({
          source: SOURCE,
          entityType: "movie" as const,
          externalId,
          label: `Kultunaut film ${externalId}`,
          reason: "cinema promotion blocked until movie identity is resolved",
          payload: { cinemaExternalId: scope },
        })),
      );
      continue;
    }

    const rows = staged.map((screening) =>
      toPromotionRow(screening, movieRefs.get(screening.sourceMovieRef)!.canonicalId),
    );
    // Crucially, the full staged desired set is promoted or nothing is. We do
    // not filter unresolved rows and then let reconciliation delete the rest.
    const outcome = await promoteCinema({
      snapshotId: ctx.snapshotId,
      source: SOURCE,
      cinemaId: cinemaRef.canonicalId,
      rows,
    });
    upserted += outcome.upserted;
    deleted += outcome.deleted;
  }

  if (unresolvedCinemas.length > 0) {
    await recordUnresolved(
      unresolvedCinemas.map((externalId) => ({
        source: SOURCE,
        entityType: "cinema" as const,
        externalId,
        label: `Kultunaut theater ${externalId}`,
        reason: "no persistent identity mapping for theater id",
      })),
    );
  }

  const nextIndex = cursor.index + batch.length;
  const run = await getRun(ctx.runId);
  const previous = (run?.stats ?? {}) as Record<string, number>;
  const stats = {
    ...previous,
    promoted: (previous.promoted ?? 0) + upserted,
    removed: (previous.removed ?? 0) + deleted,
    skippedEbillet: (previous.skippedEbillet ?? 0) + skippedEbillet,
    unresolvedCinemas: (previous.unresolvedCinemas ?? 0) + unresolvedCinemas.length,
    blockedCinemas: (previous.blockedCinemas ?? 0) + blockedCinemas.length,
  };

  await checkpoint(
    ctx.runId,
    {
      phase: "promote",
      index: nextIndex,
      scopes: cursor.scopes,
      blockedMovieRefs: cursor.blockedMovieRefs,
    },
    stats,
  );
  await mirrorJob(ctx.jobId, {
    status: "running",
    phase: "promote",
    processed_showtimes: stats.promoted,
    message:
      blockedCinemas.length > 0
        ? `Promoveret ${nextIndex}/${cursor.scopes.length} biografer; ${blockedCinemas.length} i denne batch afventer film-mapping`
        : `Promoveret ${nextIndex}/${cursor.scopes.length} biografer`,
  });

  if (nextIndex >= cursor.scopes.length) return finishRun(ctx, cursor.scopes.length);
  return { done: false, status: "running", phase: "promote" };
}

async function finishRun(
  ctx: { jobId: string; runId: string; snapshotId: string },
  cinemaCount: number,
): Promise<BatchResult> {
  const purged = await purgePastScreenings(SOURCE);
  const run = await getRun(ctx.runId);
  const stats = { ...(run?.stats ?? {}), purged, cinemas: cinemaCount };
  await completeRun(ctx.runId, stats);
  await mirrorJob(ctx.jobId, {
    status: "completed",
    phase: "done",
    message: `Import færdig (${cinemaCount} biografer)`,
  });
  return { done: true, status: "completed", phase: "done" };
}

// ------------------------------------------------------------------- resumable driver

/** Process one resumable batch. Repeated calls are idempotent. */
export async function processJobBatch(jobId: string): Promise<BatchResult> {
  const ctx = await jobContext(jobId);
  const run = await getRun(ctx.runId);
  if (!run) throw new Error("Run not found");
  if (run.state === "completed") return { done: true, status: "completed", phase: "done" };
  if (run.state === "dead_letter" || run.state === "failed") {
    return {
      done: true,
      status: "failed",
      phase: "failed",
      message: run.lastError ?? undefined,
    };
  }

  await attachSnapshot(ctx.runId, ctx.snapshotId);
  const cursor = (run.cursor ?? {}) as PipelineCursor;

  try {
    if ((cursor.phase ?? "parse") === "parse") {
      return await runParsePhase({
        jobId,
        runId: ctx.runId,
        snapshotId: ctx.snapshotId,
        declaredEmpty: cursor.declaredEmpty === true,
      });
    }

    const scopes = cursor.scopes ?? (await stagedCinemaRefs(ctx.snapshotId));
    return await runPromotePhase(
      { jobId, runId: ctx.runId, snapshotId: ctx.snapshotId },
      {
        index: cursor.index ?? 0,
        scopes,
        blockedMovieRefs: cursor.blockedMovieRefs ?? [],
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const state = await failRun(ctx.runId, message);
    await mirrorJob(jobId, {
      status: state === "dead_letter" ? "failed" : "queued",
      message: message.slice(0, 500),
    });
    if (state === "dead_letter") {
      await markSnapshotFailed(ctx.snapshotId, message);
      return { done: true, status: "failed", phase: "failed", message };
    }
    return { done: false, status: "queued", phase: cursor.phase ?? "parse", message };
  }
}

/** Status for the existing Admin UI (legacy shape). */
export async function getJobStatus(jobId: string) {
  const { data, error } = await supabaseAdmin
    .from("import_jobs")
    .select(
      "id,status,phase,message,errors,created_at,updated_at,total_movies,total_cinemas,total_showtimes,processed_movies,processed_cinemas,processed_showtimes",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(`import job status: ${error.message}`);
  return data;
}
