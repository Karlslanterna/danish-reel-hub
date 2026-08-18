/**
 * Atomic, source-scoped promotion.
 *
 * All writes to `screenings` go through the `promote_screenings` RPC, which
 *  - refuses snapshots that are not validated,
 *  - refuses to write into a cinema owned by another source,
 *  - deletes ONLY rows inside its own (source, cinema) scope.
 *
 * The legacy grouped `showtimes` table is rebuilt from `screenings` right
 * after promotion so the current frontend keeps working unchanged.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ImportSource, PromotionRow } from "./types";

export type PromotionOutcome = {
  cinemaId: string;
  upserted: number;
  deleted: number;
  showtimeRows: number;
};

export async function promoteCinema(input: {
  snapshotId: string;
  source: ImportSource;
  cinemaId: string;
  rows: PromotionRow[];
  /** Skip the legacy read-model rebuild (used by backfills). */
  skipShowtimeRebuild?: boolean;
}): Promise<PromotionOutcome> {
  const { data, error } = await supabaseAdmin.rpc("promote_screenings", {
    p_snapshot_id: input.snapshotId,
    p_source: input.source,
    p_cinema_id: input.cinemaId,
    p_rows: JSON.parse(JSON.stringify(input.rows)),
  });
  if (error) throw new Error(`promotion failed for ${input.cinemaId}: ${error.message}`);
  const result = (data ?? {}) as { upserted?: number; deleted?: number };

  // Manual corrections are durable source-ref rules, not edits to generated
  // rows. Reapply them after every promotion so the next import cannot erase
  // an administrator's reviewed correction.
  // Keep the method call bound to the Supabase client. Calling an extracted
  // `rpc` function loses the client's internal `this.rest` reference in the
  // production runtime.
  const { error: overrideError } = await supabaseAdmin.rpc(
    "apply_screening_event_overrides" as never,
    {
      p_source: input.source,
      p_cinema_id: input.cinemaId,
    } as never,
  );
  if (overrideError && overrideError.code !== "42883" && overrideError.code !== "PGRST202") {
    throw new Error(`screening override application failed: ${overrideError.message}`);
  }

  let showtimeRows = 0;
  if (!input.skipShowtimeRebuild) {
    showtimeRows = await rebuildShowtimes(input.source, input.cinemaId);
  }
  return {
    cinemaId: input.cinemaId,
    upserted: result.upserted ?? 0,
    deleted: result.deleted ?? 0,
    showtimeRows,
  };
}

/** Regenerate the compatibility `showtimes` rows for one source+cinema. */
export async function rebuildShowtimes(source: ImportSource, cinemaId: string): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc("rebuild_showtimes_for_cinema", {
    p_source: source,
    p_cinema_id: cinemaId,
  });
  if (error) throw new Error(`showtime rebuild failed for ${cinemaId}: ${error.message}`);
  return (data as number | null) ?? 0;
}

/**
 * Drop screenings that already happened. Strictly source-scoped and never
 * touches cinemas, so a quiet feed can't make a venue disappear.
 */
export async function purgePastScreenings(source: ImportSource, keepDays = 1): Promise<number> {
  const cutoff = new Date(Date.now() - keepDays * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin
    .from("screenings")
    .delete()
    .eq("source", source)
    .lt("local_date", cutoff)
    .select("cinema_id");
  if (error) throw new Error(`purge failed: ${error.message}`);
  const cinemas = [...new Set((data ?? []).map((r) => r.cinema_id))];
  for (const cinemaId of cinemas) await rebuildShowtimes(source, cinemaId);
  return data?.length ?? 0;
}
