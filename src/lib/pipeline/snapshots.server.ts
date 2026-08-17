/**
 * Snapshot lifecycle: every source payload is recorded before it can change
 * anything. Only a snapshot in state `validated` is allowed to promote
 * (enforced again inside the `promote_screenings` RPC), so a truncated or
 * failed fetch can never delete live data.
 */
import { createHash } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ImportSource, NormalizedScreening, SnapshotValidation } from "./types";

export type SnapshotScope = "feed" | "cinema" | "organizer";

export type SnapshotRecord = {
  id: string;
  source: ImportSource;
  scopeType: SnapshotScope;
  scopeExternalId: string | null;
  status: "received" | "validated" | "rejected" | "promoted" | "failed";
  payloadHash: string;
};

export function hashPayload(payload: unknown): string {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload ?? null);
  return createHash("sha256").update(text).digest("hex");
}

export async function createSnapshot(input: {
  source: ImportSource;
  scopeType: SnapshotScope;
  scopeExternalId?: string | null;
  payload: unknown;
  /** Persist the raw payload (only used for the big Kultunaut XML feed). */
  storeRaw?: boolean;
}): Promise<SnapshotRecord> {
  const payloadHash = hashPayload(input.payload);
  const { data, error } = await supabaseAdmin
    .from("import_snapshots")
    .insert({
      source: input.source,
      scope_type: input.scopeType,
      scope_external_id: input.scopeExternalId ?? null,
      payload_hash: payloadHash,
      status: "received",
      raw_payload: input.storeRaw && typeof input.payload === "string" ? input.payload : null,
    })
    .select("id, source, scope_type, scope_external_id, status, payload_hash")
    .single();
  if (error || !data) throw new Error(`snapshot: create failed — ${error?.message}`);
  return {
    id: data.id,
    source: data.source as ImportSource,
    scopeType: data.scope_type as SnapshotScope,
    scopeExternalId: data.scope_external_id,
    status: data.status as SnapshotRecord["status"],
    payloadHash: data.payload_hash,
  };
}

export async function getSnapshotRaw(snapshotId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("import_snapshots")
    .select("raw_payload")
    .eq("id", snapshotId)
    .maybeSingle();
  if (error) throw new Error(`snapshot: raw read failed — ${error.message}`);
  return data?.raw_payload ?? null;
}

/** Record the validation verdict. Only `complete`/`valid-empty` may promote. */
export async function applyValidation(
  snapshotId: string,
  validation: SnapshotValidation,
): Promise<boolean> {
  const promotable = validation.verdict !== "incomplete";
  const { error } = await supabaseAdmin
    .from("import_snapshots")
    .update({
      status: promotable ? "validated" : "rejected",
      validation: validation as unknown as Record<string, unknown>,
    })
    .eq("id", snapshotId);
  if (error) throw new Error(`snapshot: validation update failed — ${error.message}`);
  return promotable;
}

export async function markSnapshotFailed(snapshotId: string, reason: string): Promise<void> {
  await supabaseAdmin
    .from("import_snapshots")
    .update({ status: "failed", validation: { reasons: [reason] } })
    .eq("id", snapshotId);
}

/** Persist the normalized rows of a snapshot (audit + resumable promotion). */
export async function stageScreenings(
  snapshotId: string,
  source: ImportSource,
  rows: NormalizedScreening[],
): Promise<number> {
  if (rows.length === 0) return 0;
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => ({
      snapshot_id: snapshotId,
      source,
      source_ref: r.sourceRef,
      source_cinema_ref: r.sourceCinemaRef,
      source_movie_ref: r.sourceMovieRef,
      starts_at: r.startsAt,
      local_date: r.localDate,
      local_time: r.localTime,
      hall: r.hall,
      ticket_url: r.ticketUrl,
      price_min: r.priceMin,
      price_max: r.priceMax,
      free_seats: r.freeSeats,
      formats: r.formats,
      languages: r.languages,
      events: r.events,
    }));
    const { error } = await supabaseAdmin
      .from("staged_screenings")
      .upsert(chunk, { onConflict: "snapshot_id,source_ref" });
    if (error) throw new Error(`snapshot: staging failed — ${error.message}`);
    written += chunk.length;
  }
  return written;
}

/** Read staged rows back for one cinema scope (resumable promotion). */
export async function loadStagedForCinema(
  snapshotId: string,
  sourceCinemaRef: string,
): Promise<NormalizedScreening[]> {
  const out: NormalizedScreening[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabaseAdmin
      .from("staged_screenings")
      .select("*")
      .eq("snapshot_id", snapshotId)
      .eq("source_cinema_ref", sourceCinemaRef)
      .order("starts_at", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(`snapshot: staged read failed — ${error.message}`);
    for (const r of data ?? []) {
      out.push({
        sourceRef: r.source_ref,
        sourceCinemaRef: r.source_cinema_ref,
        sourceMovieRef: r.source_movie_ref,
        startsAt: r.starts_at,
        localDate: r.local_date,
        localTime: r.local_time,
        hall: r.hall,
        ticketUrl: r.ticket_url,
        priceMin: r.price_min,
        priceMax: r.price_max,
        freeSeats: r.free_seats,
        formats: r.formats ?? [],
        languages: r.languages ?? [],
        events: r.events ?? [],
      });
    }
    if (!data || data.length < page) break;
  }
  return out;
}

/** Distinct cinema scopes contained in a snapshot, in stable order. */
export async function stagedCinemaRefs(snapshotId: string): Promise<string[]> {
  const seen = new Set<string>();
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabaseAdmin
      .from("staged_screenings")
      .select("source_cinema_ref")
      .eq("snapshot_id", snapshotId)
      .range(from, from + page - 1);
    if (error) throw new Error(`snapshot: scope read failed — ${error.message}`);
    for (const r of data ?? []) seen.add(r.source_cinema_ref);
    if (!data || data.length < page) break;
  }
  return [...seen].sort();
}
