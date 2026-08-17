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

const numberFrom = (value: unknown): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export const ebilletOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: organizers }, { data: runs }] = await Promise.all([
      supabaseAdmin
        .from("ebillet_organizers")
        .select(
          "id, name, city, is_active, showtime_count, last_synced_at, last_sync_status, last_sync_error, last_sync_counts, cinema_id",
        )
        .order("name", { ascending: true }),
      supabaseAdmin
        .from("import_runs")
        .select("*")
        .eq("source", "ebillet")
        .eq("scope_type", "organizer")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    const list = organizers ?? [];
    return {
      totals: {
        organizers: list.length,
        active: list.filter((o) => o.is_active).length,
        linked: list.filter((o) => o.cinema_id).length,
        failed: list.filter((o) => o.last_sync_status === "failed").length,
      },
      organizers: list.map((o) => ({
        id: o.id as number,
        name: o.name as string,
        city: (o.city as string | null) ?? null,
        isActive: o.is_active as boolean,
        showtimeCount: o.showtime_count as number,
        lastSyncedAt: (o.last_synced_at as string | null) ?? null,
        lastSyncStatus: (o.last_sync_status as string | null) ?? null,
        lastSyncError: (o.last_sync_error as string | null) ?? null,
        counts: (o.last_sync_counts ?? {}) as Record<string, number>,
        cinemaId: (o.cinema_id as string | null) ?? null,
      })),
      runs: (runs ?? []).map((r) => {
        const stats = (r.stats ?? {}) as Record<string, unknown>;
        const state = r.state as string;
        const startedAt = r.created_at as string;
        const finishedAt = (r.finished_at as string | null) ?? null;
        const durationSeconds = finishedAt
          ? Math.max(0, Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 1000))
          : null;
        const failed = state === "failed" || state === "dead_letter";
        const completed = state === "completed";
        const error = (r.last_error as string | null) ?? null;
        return {
          id: r.id as string,
          kind: "sync",
          status: state,
          trigger: "queue",
          message:
            error ??
            (completed
              ? `Organizer ${r.scope_key} synkroniseret via canonical screenings.`
              : `Organizer ${r.scope_key}: ${state}`),
          organizersFound: 0,
          organizersActive: 1,
          organizersSynced: completed ? 1 : 0,
          organizersFailed: failed ? 1 : 0,
          cinemas: stats.cinemaId ? 1 : 0,
          movies: numberFrom(stats.movies),
          showtimes: numberFrom(stats.screenings),
          errors: error ? [error] : [],
          startedAt,
          finishedAt,
          durationSeconds,
        };
      }),
    };
  });

export const ebilletDiscover = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ maxId: z.number().int().min(50).max(2000).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { runEbilletDiscovery } = await import("@/lib/ebillet/discovery.server");
    return runEbilletDiscovery({ trigger: "manual", maxId: data.maxId });
  });

/** One leased organizer per call; the admin client loops until done. */
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
    // Manual single-organizer sync uses the same canonical pipeline as the
    // scheduler. Promotion itself is transactionally serialized per cinema.
    const { runOrganizerPipeline } = await import("@/lib/ebillet/pipeline.server");
    return runOrganizerPipeline(data.organizerId);
  });

export const ebilletReleaseStuckRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { reapExpiredRuns } = await import("@/lib/pipeline/runs.server");
    return { released: await reapExpiredRuns("ebillet") };
  });
