import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { fetchOrganizerPayload, type EbilletMoviesResponse } from "./api.server";
import { classifyOrganizer } from "./venue-filter";

export const DEFAULT_MAX_ORGANIZER_ID = 400;
const DISCOVERY_BATCH = 10;
const DEFAULT_BUDGET_MS = 55_000;

type DiscoveryRunRow = Database["public"]["Tables"]["ebillet_sync_runs"]["Row"];

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

export type EbilletDiscoverySummary = {
  runId: string;
  kind: "discover";
  status: "running" | "completed" | "failed";
  organizersFound: number;
  organizersActive: number;
  organizersSynced: 0;
  organizersFailed: 0;
  cinemas: 0;
  movies: 0;
  showtimes: 0;
  errors: string[];
  message: string | null;
  done: boolean;
};

function extractOrganizers(payload: EbilletMoviesResponse): DiscoveredOrganizer[] {
  return payload.organizers.map((organizer) => ({
    id: organizer.id,
    name: organizer.name,
    city: organizer.address?.city ?? null,
    zip: organizer.address?.zip ?? null,
    address: organizer.address?.roadAndNumber ?? null,
    region: organizer.address?.region ?? null,
    locationCount: organizer.locations?.length ?? 0,
    showtimeCount: payload.showtimes.filter((showtime) => showtime.organizerId === organizer.id).length,
  }));
}

/**
 * Probe eBillet's organizer id space without mutating canonical screenings.
 * Discovery only maintains the organizer registry; canonical promotion is the
 * responsibility of runner.server.ts + pipeline.server.ts.
 */
export async function discoverOrganizers(opts: {
  fromId?: number;
  maxId?: number;
  budgetMs?: number;
}): Promise<{ nextId: number | null; found: DiscoveredOrganizer[]; errors: string[] }> {
  const maxId = opts.maxId ?? DEFAULT_MAX_ORGANIZER_ID;
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const startedAt = Date.now();
  let cursor = Math.max(1, opts.fromId ?? 1);
  const found: DiscoveredOrganizer[] = [];
  const errors: string[] = [];

  while (cursor <= maxId) {
    if (Date.now() - startedAt >= budgetMs) return { nextId: cursor, found, errors };

    const ids: number[] = [];
    for (let id = cursor; id < Math.min(cursor + DISCOVERY_BATCH, maxId + 1); id++) ids.push(id);

    try {
      const payload = await fetchOrganizerPayload(ids);
      const organizers = extractOrganizers(payload);
      if (organizers.length > 0) {
        const rows = organizers.map((organizer) => ({
          id: organizer.id,
          name: organizer.name,
          city: organizer.city,
          zip: organizer.zip,
          address: organizer.address,
          region: organizer.region,
          location_count: organizer.locationCount,
          showtime_count: organizer.showtimeCount,
          is_active: organizer.showtimeCount > 0 && classifyOrganizer(organizer).isCinema,
        }));
        const { error } = await supabaseAdmin
          .from("ebillet_organizers")
          .upsert(rows, { onConflict: "id" });
        if (error) {
          errors.push(`register ${ids[0]}-${ids[ids.length - 1]}: ${error.message}`);
        } else {
          found.push(...organizers);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`discover ${ids[0]}-${ids[ids.length - 1]}: ${message}`);
      console.error(JSON.stringify({
        level: "error",
        scope: "ebillet-discovery",
        event: "batch_failed",
        from: ids[0],
        to: ids[ids.length - 1],
        message,
      }));
    }

    cursor += DISCOVERY_BATCH;
  }

  return { nextId: null, found, errors };
}

const jsonErrors = (value: DiscoveryRunRow["errors"]): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

async function finishRun(
  run: DiscoveryRunRow,
  status: "completed" | "failed",
  message: string | null,
  errors: string[],
): Promise<void> {
  const durationSeconds = Math.max(
    0,
    Math.round((Date.now() - Date.parse(run.started_at)) / 100) / 10,
  );
  const { error } = await supabaseAdmin
    .from("ebillet_sync_runs")
    .update({
      status,
      message,
      errors: errors.slice(-200),
      finished_at: new Date().toISOString(),
      duration_seconds: durationSeconds,
    })
    .eq("id", run.id);
  if (error) throw new Error(`discovery run finish: ${error.message}`);
}

/**
 * Run or resume discovery only. Unlike the retired mixed sync driver, this
 * never resumes an unrelated sync job and never performs canonical writes.
 */
export async function runEbilletDiscovery(opts: {
  trigger?: string;
  budgetMs?: number;
  maxId?: number;
} = {}): Promise<EbilletDiscoverySummary> {
  const { data: running, error: runningError } = await supabaseAdmin
    .from("ebillet_sync_runs")
    .select("*")
    .eq("kind", "discover")
    .eq("status", "running")
    .order("started_at", { ascending: true })
    .limit(1);
  if (runningError) throw new Error(`discovery run lookup: ${runningError.message}`);

  let run = (running?.[0] ?? null) as DiscoveryRunRow | null;
  if (!run) {
    const { data, error } = await supabaseAdmin
      .from("ebillet_sync_runs")
      .insert({
        kind: "discover",
        trigger: opts.trigger ?? "manual",
        status: "running",
        cursor: 0,
      })
      .select("*")
      .single();
    if (error || !data) throw new Error(`discovery run create: ${error?.message ?? "missing row"}`);
    run = data;
  }

  const errors = jsonErrors(run.errors);
  try {
    const result = await discoverOrganizers({
      fromId: run.cursor > 0 ? run.cursor : 1,
      maxId: opts.maxId,
      budgetMs: opts.budgetMs ?? DEFAULT_BUDGET_MS,
    });
    errors.push(...result.errors);

    const [{ count: foundCount, error: foundError }, { count: activeCount, error: activeError }] =
      await Promise.all([
        supabaseAdmin.from("ebillet_organizers").select("id", { count: "exact", head: true }),
        supabaseAdmin
          .from("ebillet_organizers")
          .select("id", { count: "exact", head: true })
          .eq("is_active", true),
      ]);
    if (foundError) throw new Error(`discovery count: ${foundError.message}`);
    if (activeError) throw new Error(`discovery active count: ${activeError.message}`);

    const organizersFound = foundCount ?? 0;
    const organizersActive = activeCount ?? 0;
    const done = result.nextId === null;
    const message = done
      ? `Fandt ${organizersFound} organizers, heraf ${organizersActive} aktive biografer`
      : `Scanner… næste id ${result.nextId}`;

    const { error: updateError } = await supabaseAdmin
      .from("ebillet_sync_runs")
      .update({
        cursor: result.nextId ?? 0,
        organizers_found: organizersFound,
        organizers_active: organizersActive,
        errors: errors.slice(-200),
        message,
      })
      .eq("id", run.id);
    if (updateError) throw new Error(`discovery run checkpoint: ${updateError.message}`);

    if (done) await finishRun(run, "completed", message, errors);

    return {
      runId: run.id,
      kind: "discover",
      status: done ? "completed" : "running",
      organizersFound,
      organizersActive,
      organizersSynced: 0,
      organizersFailed: 0,
      cinemas: 0,
      movies: 0,
      showtimes: 0,
      errors: errors.slice(-20),
      message,
      done,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(message);
    await finishRun(run, "failed", message, errors);
    return {
      runId: run.id,
      kind: "discover",
      status: "failed",
      organizersFound: run.organizers_found,
      organizersActive: run.organizers_active,
      organizersSynced: 0,
      organizersFailed: 0,
      cinemas: 0,
      movies: 0,
      showtimes: 0,
      errors: errors.slice(-20),
      message,
      done: true,
    };
  }
}
