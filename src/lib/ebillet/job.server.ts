import { syncOrganizer } from "./sync.server";

type RunRow = {
  id: string;
  status: string;
  cursor: number;
  organizers_active: number;
  organizers_synced: number;
  organizers_failed: number;
  cinemas_upserted: number;
  movies_upserted: number;
  showtimes_upserted: number;
  errors: string[] | null;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * One durable unit of eBillet work is exactly one organizer.
 * The cursor is committed after every organizer, so a killed request can
 * never make the database lose several minutes of progress.
 */
export async function runEbilletOrganizerBatch(): Promise<{
  runId: string;
  status: "running" | "completed" | "failed";
  cursor: number;
  organizersActive: number;
  organizersSynced: number;
  organizersFailed: number;
  message: string;
}> {
  const db = await admin();

  const { data: active, error: activeError } = await db
    .from("ebillet_organizers")
    .select("id")
    .eq("is_active", true)
    .order("id", { ascending: true });
  if (activeError) throw new Error(`organizer-liste: ${activeError.message}`);

  const ids = (active ?? []).map((r: { id: number }) => r.id);

  let { data: run } = await db
    .from("ebillet_sync_runs")
    .select("*")
    .eq("status", "running")
    .eq("kind", "sync")
    .order("started_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!run) {
    const { data: created, error } = await db
      .from("ebillet_sync_runs")
      .insert({
        kind: "sync",
        trigger: "manual",
        status: "running",
        cursor: 0,
        organizers_active: ids.length,
        organizers_synced: 0,
        organizers_failed: 0,
        cinemas_upserted: 0,
        movies_upserted: 0,
        showtimes_upserted: 0,
        errors: [],
        message: `Starter eBillet sync: 0/${ids.length}`,
      })
      .select("*")
      .single();
    if (error) throw new Error(`Kunne ikke starte eBillet-kørsel: ${error.message}`);
    run = created;
  }

  const r = run as RunRow;
  const cursor = Math.max(0, r.cursor ?? 0);

  if (cursor >= ids.length) {
    await db.from("ebillet_sync_runs").update({
      status: "completed",
      cursor: 0,
      organizers_active: ids.length,
      message: `Synkroniserede ${r.organizers_synced}/${ids.length} biografer`,
      finished_at: new Date().toISOString(),
    }).eq("id", r.id);
    return {
      runId: r.id, status: "completed", cursor: 0,
      organizersActive: ids.length, organizersSynced: r.organizers_synced,
      organizersFailed: r.organizers_failed,
      message: `Synkroniserede ${r.organizers_synced}/${ids.length} biografer`,
    };
  }

  const organizerId = ids[cursor]!;
  let synced = r.organizers_synced ?? 0;
  let failed = r.organizers_failed ?? 0;
  let cinemas = r.cinemas_upserted ?? 0;
  let movies = r.movies_upserted ?? 0;
  let showtimes = r.showtimes_upserted ?? 0;
  const errors = Array.isArray(r.errors) ? [...r.errors] : [];

  try {
    const counts = await syncOrganizer(organizerId);
    synced += 1;
    cinemas += counts.cinemas;
    movies += counts.movies;
    showtimes += counts.showtimes;
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`organizer ${organizerId}: ${message}`);
    await db.from("ebillet_organizers").update({
      last_synced_at: new Date().toISOString(),
      last_sync_status: "failed",
      last_sync_error: message.slice(0, 500),
    }).eq("id", organizerId);
  }

  const next = cursor + 1;
  const done = next >= ids.length;
  await db.from("ebillet_sync_runs").update({
    status: done ? "completed" : "running",
    cursor: done ? 0 : next,
    organizers_active: ids.length,
    organizers_synced: synced,
    organizers_failed: failed,
    cinemas_upserted: cinemas,
    movies_upserted: movies,
    showtimes_upserted: showtimes,
    errors: errors.slice(-200),
    message: done ? `Synkroniserede ${synced}/${ids.length} biografer` : `Synkroniserer ${next}/${ids.length}`,
    ...(done ? { finished_at: new Date().toISOString() } : {}),
  }).eq("id", r.id);

  return {
    runId: r.id,
    status: done ? "completed" : "running",
    cursor: done ? 0 : next,
    organizersActive: ids.length,
    organizersSynced: synced,
    organizersFailed: failed,
    message: done ? `Synkroniserede ${synced}/${ids.length} biografer` : `Synkroniserer ${next}/${ids.length}`,
  };
}
