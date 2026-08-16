import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(context: { supabase: unknown; userId: string }) {
  const { supabase, userId } = context as {
    supabase: {
      from: (table: string) => {
        select: (cols: string) => {
          eq: (col: string, val: unknown) => {
            eq: (col: string, val: unknown) => {
              maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
            };
          };
        };
      };
    };
    userId: string;
  };
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error("Forbidden: role lookup failed");
  if (!data) throw new Error("Forbidden: admin role required");
}

export const ebilletOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: organizers }, { data: runs }] = await Promise.all([
      supabaseAdmin.from("ebillet_organizers").select("id, name, city, is_active, showtime_count, last_synced_at, last_sync_status, last_sync_error, last_sync_counts, cinema_id").order("name", { ascending: true }),
      supabaseAdmin.from("ebillet_sync_runs").select("*").order("started_at", { ascending: false }).limit(10),
    ]);
    const list = organizers ?? [];
    return {
      totals: { organizers: list.length, active: list.filter((o) => o.is_active).length, linked: list.filter((o) => o.cinema_id).length, failed: list.filter((o) => o.last_sync_status === "failed").length },
      organizers: list.map((o) => ({ id: o.id as number, name: o.name as string, city: (o.city as string | null) ?? null, isActive: o.is_active as boolean, showtimeCount: o.showtime_count as number, lastSyncedAt: (o.last_synced_at as string | null) ?? null, lastSyncStatus: (o.last_sync_status as string | null) ?? null, lastSyncError: (o.last_sync_error as string | null) ?? null, counts: (o.last_sync_counts ?? {}) as Record<string, number>, cinemaId: (o.cinema_id as string | null) ?? null })),
      runs: (runs ?? []).map((r) => ({ id: r.id as string, kind: r.kind as string, status: r.status as string, trigger: r.trigger as string, message: (r.message as string | null) ?? null, organizersFound: r.organizers_found as number, organizersActive: r.organizers_active as number, organizersSynced: r.organizers_synced as number, organizersFailed: r.organizers_failed as number, cinemas: r.cinemas_upserted as number, movies: r.movies_upserted as number, showtimes: r.showtimes_upserted as number, errors: ((r.errors as string[] | null) ?? []).slice(-5), startedAt: r.started_at as string, finishedAt: (r.finished_at as string | null) ?? null, durationSeconds: (r.duration_seconds as number | null) ?? null })),
    };
  });

export const ebilletDiscover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ maxId: z.number().int().min(50).max(2000).optional() }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { runEbilletJob } = await import("@/lib/ebillet/sync.server");
    return runEbilletJob({ kind: "discover", trigger: "manual", maxId: data.maxId });
  });

/** Durable one-organizer batch. The client may call this repeatedly until completed. */
export const ebilletSyncAll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { runEbilletOrganizerBatch } = await import("@/lib/ebillet/job.server");
    return runEbilletOrganizerBatch();
  });

export const ebilletSyncOne = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ organizerId: z.number().int().positive() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { syncOrganizer } = await import("@/lib/ebillet/sync.server");
    return syncOrganizer(data.organizerId);
  });

export const ebilletReleaseStuckRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { reapStaleEbilletRuns } = await import("@/lib/ebillet/sync.server");
    return { released: await reapStaleEbilletRuns(0) };
  });
