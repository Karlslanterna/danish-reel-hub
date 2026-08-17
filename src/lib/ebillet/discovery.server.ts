/**
 * eBillet organizer discovery only.
 *
 * Canonical cinema/movie/screening synchronization lives in runner.server.ts
 * and pipeline.server.ts. This module only probes eBillet's organizer id space
 * and maintains the ebillet_organizers registry.
 *
 * Discovery keeps the old ebillet_sync_runs checkpoint table temporarily
 * because it is registry maintenance rather than canonical data promotion.
 * No function in this module writes movies, cinemas, showtimes or screenings.
 */
import { fetchOrganizerPayload, type EbilletMoviesResponse } from "./api.server";
import { classifyOrganizer } from "./venue-filter";

export const DEFAULT_MAX_ORGANIZER_ID = 400;
const DISCOVERY_BATCH = 10;
const WALL_CLOCK_BUDGET_MS = 55_000;

export type DiscoveredOrganizer = {
  id: number;
  name: string;
  city: string | null;
  zip: string | null;
  address: string | null;
  region: string | null;
  locationCount: number;
  showtimeCount: number;
};

export type DiscoveryRunSummary = {
  runId: string;
  kind: "discover";
  status: "running" | "completed" | "failed";
  organizersFound: number;
  organizersActive: number;
  organizersSynced: 0;
  organizersFailed: number;
  cinemas: 0;
  movies: 0;
  showtimes: 0;
  errors: string[];
  message: string | null;
  done: boolean;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function extractOrganizers(payload: EbilletMoviesResponse): DiscoveredOrganizer[] {
  return payload.organizers.map((o) => ({
    id: o.id,
    name: o.name,
    city: o.address?.city ?? null,
    zip: o.address?.zip ?? null,
    address: o.address?.roadAndNumber ?? null,
    region: o.address?.region ?? null,
    locationCount: o.locations?.length ?? 0,
    showtimeCount: payload.showtimes.filter((s) => s.organizerId === o.id).length,
  }));
}

export async function discoverOrganizers(opts: {
  fromId?: number;
  maxId?: number;
  budgetMs?: number;
} = {}): Promise<{
  nextId: number | null;
  found: DiscoveredOrganizer[];
  errors: string[];
}> {
  const db = await admin();
  const maxId = opts.maxId ?? DEFAULT_MAX_ORGANIZER_ID;
  const budgetMs = opts.budgetMs ?? WALL_CLOCK_BUDGET_MS;
  const startedAt = Date.now();
  let cursor = Math.max(1, opts.fromId ?? 1);
  const found: DiscoveredOrganizer[] = [];
  const errors: string[] = [];

  while (cursor <= maxId) {
    if (Date.now() - startedAt > budgetMs) {
      return { nextId: cursor, found, errors };
    }

    const ids: number[] = [];
    for (let id = cursor; id < Math.min(cursor + DISCOVERY_BATCH, maxId + 1); id++) ids.push(id);

    try {
      const payload = await fetchOrganizerPayload(ids);
      const organizers = extractOrganizers(payload);
      if (organizers.length > 0) {
        const rows = organizers.map((o) => ({
          id: o.id,
          name: o.name,
          city: o.city,
          zip: o.zip,
          address: o.address,
          region: o.region,
          location_count: o.locationCount,
          showtime_count: o.showtimeCount,
          is_active: o.showtimeCount > 0 && classifyOrganizer({ id: o.id, name: o.name }).isCinema,
        }));
        const { error } = await db.from("ebillet_organizers").upsert(rows, { onConflict: "id" });
        if (error) errors.push(`register ${ids[0]}-${ids[ids.length - 1]}: ${error.message}`);
        found.push(...organizers);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`discover ${ids[0]}-${ids[ids.length - 1]}: ${message}`);
      console.error(
        JSON.stringify({
          level: "error",
          scope: "ebillet-discovery",
          event: "batch_failed",
          from: ids[0],
          to: ids[ids.length - 1],
          message,
        }),
      );
    }

    cursor += DISCOVERY_BATCH;
  }

  return { nextId: null, found, errors };
}

type DiscoveryRunRow = {
  id: string;
  cursor: number;
  organizers_found: number;
  organizers_active: number;
  organizers_failed: number;
  errors: string[] | null;
  started_at: string;
};

/**
 * Start or resume the organizer registry scan. This is the only remaining use
 * of ebillet_sync_runs; canonical imports use import_runs exclusively.
 */
export async function runEbilletDiscoveryJob(opts: {
  trigger?: string;
  budgetMs?: number;
  maxId?: number;
} = {}): Promise<DiscoveryRunSummary> {
  const db = await admin();
  const budgetMs = opts.budgetMs ?? WALL_CLOCK_BUDGET_MS;

  const { data: runningRows, error: runningError } = await db
    .from("ebillet_sync_runs")
    .select("id,cursor,organizers_found,organizers_active,organizers_failed,errors,started_at")
    .eq("kind", "discover")
    .eq("status", "running")
    .order("started_at", { ascending: true })
    .limit(1);
  if (runningError) throw new Error(`discovery checkpoint lookup: ${runningError.message}`);

  let run = ((runningRows ?? [])[0] ?? null) as DiscoveryRunRow | null;
  if (!run) {
    const { data, error } = await db
      .from("ebillet_sync_runs")
      .insert({
        kind: "discover",
        trigger: opts.trigger ?? "manual",
        status: "running",
        cursor: 1,
      })
      .select("id,cursor,organizers_found,organizers_active,organizers_failed,errors,started_at")
      .single();
    if (error) throw new Error(`Kunne ikke starte eBillet discovery: ${error.message}`);
    run = data as DiscoveryRunRow;
  }

  const errors = Array.isArray(run.errors) ? [...run.errors] : [];

  try {
    const result = await discoverOrganizers({
      fromId: run.cursor > 0 ? run.cursor : 1,
      maxId: opts.maxId,
      budgetMs,
    });
    errors.push(...result.errors);

    const [{ count: foundCount, error: foundError }, { count: activeCount, error: activeError }] =
      await Promise.all([
        db.from("ebillet_organizers").select("id", { count: "exact", head: true }),
        db
          .from("ebillet_organizers")
          .select("id", { count: "exact", head: true })
          .eq("is_active", true),
      ]);
    if (foundError) throw new Error(`organizer count: ${foundError.message}`);
    if (activeError) throw new Error(`active organizer count: ${activeError.message}`);

    const done = result.nextId === null;
    const message = done
      ? `Fandt ${foundCount ?? 0} organizers, heraf ${activeCount ?? 0} aktive biografer`
      : `Scanner… næste id ${result.nextId}`;
    const finishedAt = done ? new Date().toISOString() : null;
    const durationSeconds = done
      ? Math.max(0, Math.round((Date.now() - Date.parse(run.started_at)) / 100) / 10)
      : null;

    const { error: updateError } = await db
      .from("ebillet_sync_runs")
      .update({
        cursor: result.nextId ?? 0,
        organizers_found: foundCount ?? 0,
        organizers_active: activeCount ?? 0,
        organizers_failed: errors.length,
        errors: errors.slice(-200),
        message,
        status: done ? "completed" : "running",
        finished_at: finishedAt,
        duration_seconds: durationSeconds,
      })
      .eq("id", run.id);
    if (updateError) throw new Error(`discovery checkpoint update: ${updateError.message}`);

    return {
      runId: run.id,
      kind: "discover",
      status: done ? "completed" : "running",
      organizersFound: foundCount ?? 0,
      organizersActive: activeCount ?? 0,
      organizersSynced: 0,
      organizersFailed: errors.length,
      cinemas: 0,
      movies: 0,
      showtimes: 0,
      errors: errors.slice(-20),
      message,
      done,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(message);
    await db
      .from("ebillet_sync_runs")
      .update({
        status: "failed",
        message: "Discovery failed",
        errors: errors.slice(-200),
        finished_at: new Date().toISOString(),
      })
      .eq("id", run.id);
    console.error("[ebillet-discovery] run failed:", message);
    return {
      runId: run.id,
      kind: "discover",
      status: "failed",
      organizersFound: run.organizers_found ?? 0,
      organizersActive: run.organizers_active ?? 0,
      organizersSynced: 0,
      organizersFailed: Math.max(1, run.organizers_failed ?? 0),
      cinemas: 0,
      movies: 0,
      showtimes: 0,
      errors: errors.slice(-20),
      message: "Discovery failed",
      done: true,
    };
  }
}
