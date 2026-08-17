/**
 * Kultunaut import pipeline — the active path.
 *
 *   fetch -> validate -> normalize -> resolve -> stage -> promote -> mark
 *
 * Kultunaut is authoritative ONLY for cinemas that are not linked to an
 * eBillet organizer. Scopes owned by eBillet are skipped entirely, so a
 * Kultunaut run can never insert into or delete from eBillet territory
 * (the `promote_screenings` RPC enforces the same rule in the database).
 *
 * The run is resumable: work is checkpointed into `import_runs.cursor` after
 * every batch, and the legacy `import_jobs` row is kept up to date purely so
 * the existing admin UI keeps working.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { parseKultunautXml, type ParsedCinema, type ParsedMovie } from "./parser.server";
import { validateKultunautSnapshot } from "./snapshot";
import { normalizeKultunautScreenings } from "./normalize";
import {
  applyValidation,
  createSnapshot,
  getSnapshotRaw,
  loadStagedForCinema,
  stageScreenings,
  stagedCinemaRefs,
} from "@/lib/pipeline/snapshots.server";
import { promoteCinema, purgePastScreenings } from "@/lib/pipeline/promote.server";
import { loadRefs, recordUnresolved, upsertRefs } from "@/lib/pipeline/identity.server";
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

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[æø]/g, (c) => (c === "æ" ? "ae" : "oe"))
    .replace(/å/g, "aa")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const stripYearSuffix = (title: string): string =>
  title.replace(/\s*[([]\s*(?:19|20)\d{2}\s*[)\]]\s*$/u, "").trim();

const idFor = (ext: string) => `kn-${ext}`;

// ------------------------------------------------------------------- create

/**
 * Register a feed payload and queue a run. Returns the legacy job id so the
 * existing admin screens and API routes keep working unchanged.
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
    .select("id, status, phase, payload")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(`import job read: ${error.message}`);
  if (!data) throw new Error("Job not found");
  const payload = (data.payload ?? {}) as { run_id?: string; snapshot_id?: string };
  if (!payload.run_id || !payload.snapshot_id) {
    throw new Error("Job blev oprettet af den gamle importer og kan ikke genoptages her");
  }
  return { jobId, runId: payload.run_id, snapshotId: payload.snapshot_id, status: data.status };
}

async function mirrorJob(jobId: string, patch: Record<string, unknown>): Promise<void> {
  await supabaseAdmin.from("import_jobs").update(patch as never).eq("id", jobId);
}

// -------------------------------------------------------------------- parse

async function runParsePhase(ctx: {
  jobId: string;
  runId: string;
  snapshotId: string;
  declaredEmpty: boolean;
}): Promise<BatchResult> {
  const xml = (await getSnapshotRaw(ctx.snapshotId)) ?? "";
  const parsed = parseKultunautXml(xml);

  const validation = validateKultunautSnapshot({
    xmlLength: xml.length,
    movies: parsed.movies.size,
    cinemas: parsed.cinemas.size,
    showtimes: parsed.showtimes.length,
    grouped: parsed.showtimes.length,
    declaredEmpty: ctx.declaredEmpty,
  });
  await applyValidation(ctx.snapshotId, {
    verdict: validation.verdict,
    reasons: validation.reasons,
    stats: {
      xmlLength: xml.length,
      movies: parsed.movies.size,
      cinemas: parsed.cinemas.size,
      showtimes: parsed.showtimes.length,
    },
  });
  if (validation.verdict === "incomplete") {
    await mirrorJob(ctx.jobId, {
      status: "failed",
      phase: "parse",
      message: `Snapshot afvist: ${validation.reasons.join("; ")}`,
    });
    await failRun(ctx.runId, `snapshot incomplete: ${validation.reasons.join("; ")}`);
    return { done: true, status: "failed", phase: "parse", message: validation.reasons.join("; ") };
  }

  // ---- canonical movie per normalized title (keep the richest profile) ----
  const score = (m: ParsedMovie): number => {
    let s = 0;
    const posters = [m.poster.a, m.poster.b, m.poster.c, m.poster.d, m.poster.url];
    if (posters.some((v) => v && v.trim() !== "")) s += 10;
    if (m.runtime > 0) s += 5;
    if (m.synopsis.trim().length > 20) s += 3;
    if (m.director.trim() !== "") s += 2;
    if (m.rating.trim() !== "") s += 1;
    if (m.genre.length > 0) s += 1;
    if (m.original_title?.trim()) s += 1;
    return s;
  };
  const byTitle = new Map<string, string[]>();
  for (const m of parsed.movies.values()) {
    const key = slugify(stripYearSuffix(m.title));
    byTitle.set(key, [...(byTitle.get(key) ?? []), m.external_id]);
  }
  const canonicalExternal = new Map<string, string>();
  for (const [, extIds] of byTitle) {
    const ranked = extIds
      .map((eid) => ({ eid, m: parsed.movies.get(eid)! }))
      .sort((a, b) => score(b.m) - score(a.m));
    for (const { eid } of ranked) canonicalExternal.set(eid, ranked[0]!.eid);
  }

  // ---- movies -------------------------------------------------------------
  const movieRows = [...parsed.movies.values()]
    .filter((m) => canonicalExternal.get(m.external_id) === m.external_id)
    .map((m: ParsedMovie) => ({
      id: idFor(m.external_id),
      slug: slugify(m.title) || idFor(m.external_id),
      external_id: m.external_id,
      title: m.title,
      original_title: m.original_title,
      runtime: m.runtime,
      genre: m.genre,
      year: m.year,
      director: m.director,
      rating: m.rating,
      synopsis: m.synopsis,
      poster: m.poster,
      source: SOURCE,
    }));
  for (let i = 0; i < movieRows.length; i += 500) {
    const { error } = await supabaseAdmin
      .from("movies")
      .upsert(movieRows.slice(i, i + 500) as never, { onConflict: "id" });
    if (error) throw new Error(`movies upsert: ${error.message}`);
  }

  // ---- cinemas ------------------------------------------------------------
  const cinemaRows = [...parsed.cinemas.values()].map((c: ParsedCinema) => ({
    id: idFor(c.external_id),
    slug: slugify(c.name) || idFor(c.external_id),
    external_id: c.external_id,
    name: c.name,
    city: c.city,
    address: c.address,
    description: c.description,
    screens: c.screens,
    latitude: c.latitude,
    longitude: c.longitude,
    source: SOURCE,
  }));
  // Never downgrade an eBillet-owned cinema: those rows are updated by
  // eBillet only, so they are excluded from the Kultunaut upsert.
  const ebilletOwned = await loadEbilletOwnedCinemaIds();
  const writableCinemas = cinemaRows.filter((c) => !ebilletOwned.has(c.id));
  for (let i = 0; i < writableCinemas.length; i += 500) {
    const { error } = await supabaseAdmin
      .from("cinemas")
      .upsert(writableCinemas.slice(i, i + 500) as never, { onConflict: "id" });
    if (error) throw new Error(`cinemas upsert: ${error.message}`);
  }

  // ---- identity refs ------------------------------------------------------
  await upsertRefs([
    ...cinemaRows.map((c) => ({
      source: SOURCE,
      entityType: "cinema" as const,
      externalId: c.external_id,
      canonicalId: c.id,
      matchMethod: "external_id" as const,
      confidence: 1,
      locked: true,
    })),
    ...[...parsed.movies.values()].map((m) => ({
      source: SOURCE,
      entityType: "movie" as const,
      externalId: m.external_id,
      canonicalId: idFor(canonicalExternal.get(m.external_id) ?? m.external_id),
      matchMethod: "external_id" as const,
      confidence: 1,
      locked: false,
      notes: canonicalExternal.get(m.external_id) === m.external_id ? undefined : "merged duplicate title",
    })),
  ]);

  // ---- staging ------------------------------------------------------------
  const normalized = normalizeKultunautScreenings(parsed.showtimes);
  await stageScreenings(ctx.snapshotId, SOURCE, normalized);

  const scopes = [...new Set(normalized.map((s) => s.sourceCinemaRef))].sort();
  await checkpoint(ctx.runId, { phase: "promote", index: 0, scopes }, {
    movies: movieRows.length,
    cinemas: cinemaRows.length,
    screenings: normalized.length,
  });
  await mirrorJob(ctx.jobId, {
    status: "running",
    phase: "promote",
    total_movies: movieRows.length,
    total_cinemas: cinemaRows.length,
    total_showtimes: normalized.length,
    processed_movies: movieRows.length,
    processed_cinemas: writableCinemas.length,
    message: "Normaliseret — klar til promovering",
  });
  return { done: false, status: "running", phase: "promote" };
}

/** Cinemas owned by eBillet — ownership is the LINK, never `is_active`. */
async function loadEbilletOwnedCinemaIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  const [linked, organizers] = await Promise.all([
    supabaseAdmin.from("cinemas").select("id").not("ebillet_organizer_id", "is", null),
    supabaseAdmin.from("ebillet_organizers").select("cinema_id").not("cinema_id", "is", null),
  ]);
  if (linked.error) throw new Error(`ebillet coverage: ${linked.error.message}`);
  if (organizers.error) throw new Error(`ebillet coverage: ${organizers.error.message}`);
  for (const r of linked.data ?? []) ids.add(r.id);
  for (const r of organizers.data ?? []) if (r.cinema_id) ids.add(r.cinema_id);
  return ids;
}

// ------------------------------------------------------------------ promote

async function runPromotePhase(
  ctx: { jobId: string; runId: string; snapshotId: string },
  cursor: { index: number; scopes: string[] },
): Promise<BatchResult> {
  const { scopes } = cursor;
  const batch = scopes.slice(cursor.index, cursor.index + CINEMAS_PER_BATCH);
  if (batch.length === 0) return finishRun(ctx, scopes.length);

  const cinemaRefs = await loadRefs(SOURCE, "cinema", batch);
  const ebilletOwned = await loadEbilletOwnedCinemaIds();
  const unresolved: string[] = [];
  let upserted = 0;
  let deleted = 0;
  let skipped = 0;

  for (const scope of batch) {
    const ref = cinemaRefs.get(scope);
    if (!ref) {
      unresolved.push(scope);
      continue;
    }
    if (ebilletOwned.has(ref.canonicalId)) {
      skipped += 1;
      continue;
    }
    const staged = await loadStagedForCinema(ctx.snapshotId, scope);
    const movieRefs = await loadRefs(SOURCE, "movie", staged.map((s) => s.sourceMovieRef));
    const rows = staged
      .filter((s) => movieRefs.has(s.sourceMovieRef))
      .map((s) => toPromotionRow(s, movieRefs.get(s.sourceMovieRef)!.canonicalId));
    const outcome = await promoteCinema({
      snapshotId: ctx.snapshotId,
      source: SOURCE,
      cinemaId: ref.canonicalId,
      rows,
    });
    upserted += outcome.upserted;
    deleted += outcome.deleted;
  }

  if (unresolved.length) {
    await recordUnresolved(
      unresolved.map((externalId) => ({
        source: SOURCE,
        entityType: "cinema" as const,
        externalId,
        label: `kultunaut theater ${externalId}`,
        reason: "no identity mapping for theater id",
      })),
    );
  }

  const nextIndex = cursor.index + batch.length;
  const run = await getRun(ctx.runId);
  const prev = (run?.stats ?? {}) as Record<string, number>;
  const stats = {
    ...prev,
    promoted: (prev.promoted ?? 0) + upserted,
    removed: (prev.removed ?? 0) + deleted,
    skippedEbillet: (prev.skippedEbillet ?? 0) + skipped,
    unresolvedCinemas: (prev.unresolvedCinemas ?? 0) + unresolved.length,
  };
  await checkpoint(ctx.runId, { phase: "promote", index: nextIndex, scopes }, stats);
  await mirrorJob(ctx.jobId, {
    status: "running",
    phase: "promote",
    processed_showtimes: stats.promoted,
    message: `Promoveret ${nextIndex}/${scopes.length} biografer`,
  });

  if (nextIndex >= scopes.length) return finishRun(ctx, scopes.length);
  return { done: false, status: "running", phase: "promote" };
}

async function finishRun(
  ctx: { jobId: string; runId: string; snapshotId: string },
  cinemaCount: number,
): Promise<BatchResult> {
  const purged = await purgePastScreenings(SOURCE);
  const run = await getRun(ctx.runId);
  await completeRun(ctx.runId, { ...(run?.stats ?? {}), purged, cinemas: cinemaCount });
  await mirrorJob(ctx.jobId, {
    status: "completed",
    phase: "done",
    message: `Import færdig (${cinemaCount} biografer)`,
  });
  return { done: true, status: "completed", phase: "done" };
}

// -------------------------------------------------------------------- batch

/** Process one resumable batch of an import job. */
export async function processJobBatch(jobId: string): Promise<BatchResult> {
  const ctx = await jobContext(jobId);
  const run = await getRun(ctx.runId);
  if (!run) throw new Error("Run not found");
  if (run.state === "completed") return { done: true, status: "completed", phase: "done" };
  if (run.state === "dead_letter" || run.state === "failed") {
    return { done: true, status: "failed", phase: "failed", message: run.lastError ?? undefined };
  }
  await attachSnapshot(ctx.runId, ctx.snapshotId);

  const cursor = (run.cursor ?? {}) as {
    phase?: string;
    index?: number;
    scopes?: string[];
    declaredEmpty?: boolean;
  };

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
      { index: cursor.index ?? 0, scopes },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const state = await failRun(ctx.runId, message);
    await mirrorJob(jobId, {
      status: state === "dead_letter" ? "failed" : "queued",
      message: message.slice(0, 500),
    });
    if (state === "dead_letter") return { done: true, status: "failed", phase: "failed", message };
    return { done: false, status: "queued", phase: cursor.phase ?? "parse", message };
  }
}

/** Status for the admin UI (legacy shape). */
export async function getJobStatus(jobId: string) {
  const { data, error } = await supabaseAdmin
    .from("import_jobs")
    .select(
      "id, status, phase, message, errors, created_at, updated_at, total_movies, total_cinemas, total_showtimes, processed_movies, processed_cinemas, processed_showtimes",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(`import job status: ${error.message}`);
  return data;
}
