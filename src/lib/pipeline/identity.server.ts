/**
 * Deterministic identity mapping between source-native ids and canonical rows.
 *
 * The pipeline NEVER re-derives identity from names/titles once a ref exists:
 * a resolved mapping is stored in `source_entity_refs` and reused forever.
 * Locked refs (external-id based) can only be changed by hand.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ImportSource, UnresolvedEntity } from "./types";

export type EntityType = "cinema" | "movie";

export type EntityRef = {
  externalId: string;
  canonicalId: string;
  locked: boolean;
  matchMethod: string;
};

/** Load existing refs for a set of external ids. Chunked to keep URLs sane. */
export async function loadRefs(
  source: ImportSource,
  entityType: EntityType,
  externalIds: string[],
): Promise<Map<string, EntityRef>> {
  const out = new Map<string, EntityRef>();
  const ids = [...new Set(externalIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    const { data, error } = await supabaseAdmin
      .from("source_entity_refs")
      .select("external_id, canonical_id, locked, match_method")
      .eq("source", source)
      .eq("entity_type", entityType)
      .in("external_id", chunk);
    if (error) throw new Error(`identity: ref lookup failed — ${error.message}`);
    for (const r of data ?? []) {
      out.set(r.external_id, {
        externalId: r.external_id,
        canonicalId: r.canonical_id,
        locked: r.locked,
        matchMethod: r.match_method,
      });
    }
  }
  return out;
}

/** All refs pointing at a canonical row (used for merge/debug tooling). */
export async function refsForCanonical(
  entityType: EntityType,
  canonicalId: string,
): Promise<EntityRef[]> {
  const { data, error } = await supabaseAdmin
    .from("source_entity_refs")
    .select("external_id, canonical_id, locked, match_method")
    .eq("entity_type", entityType)
    .eq("canonical_id", canonicalId);
  if (error) throw new Error(`identity: reverse lookup failed — ${error.message}`);
  return (data ?? []).map((r) => ({
    externalId: r.external_id,
    canonicalId: r.canonical_id,
    locked: r.locked,
    matchMethod: r.match_method,
  }));
}

export type RefInput = {
  source: ImportSource;
  entityType: EntityType;
  externalId: string;
  canonicalId: string;
  matchMethod: "external_id" | "deterministic" | "manual" | "created";
  confidence?: number;
  locked?: boolean;
  notes?: string;
};

/**
 * Persist a mapping. An existing locked ref is never silently re-pointed —
 * a conflicting write is reported as unresolved instead, so a bad match can
 * be reviewed rather than corrupting canonical data.
 */
export async function upsertRefs(refs: RefInput[]): Promise<{ written: number; conflicts: string[] }> {
  if (refs.length === 0) return { written: 0, conflicts: [] };
  const conflicts: string[] = [];
  const existing = new Map<string, EntityRef>();
  for (const type of ["cinema", "movie"] as EntityType[]) {
    for (const source of ["ebillet", "kultunaut"] as ImportSource[]) {
      const ids = refs.filter((r) => r.entityType === type && r.source === source).map((r) => r.externalId);
      if (ids.length === 0) continue;
      const found = await loadRefs(source, type, ids);
      for (const [k, v] of found) existing.set(`${source}:${type}:${k}`, v);
    }
  }

  const writable = refs.filter((r) => {
    const prev = existing.get(`${r.source}:${r.entityType}:${r.externalId}`);
    if (!prev) return true;
    if (prev.canonicalId === r.canonicalId) return true;
    if (prev.locked) {
      conflicts.push(
        `${r.source}/${r.entityType}/${r.externalId}: locked to ${prev.canonicalId}, refused re-point to ${r.canonicalId}`,
      );
      return false;
    }
    return true;
  });

  for (let i = 0; i < writable.length; i += 200) {
    const chunk = writable.slice(i, i + 200).map((r) => ({
      source: r.source,
      entity_type: r.entityType,
      external_id: r.externalId,
      canonical_id: r.canonicalId,
      match_method: r.matchMethod,
      confidence: r.confidence ?? null,
      locked: r.locked ?? r.matchMethod === "external_id",
      notes: r.notes ?? null,
    }));
    const { error } = await supabaseAdmin
      .from("source_entity_refs")
      .upsert(chunk, { onConflict: "source,entity_type,external_id" });
    if (error) throw new Error(`identity: ref upsert failed — ${error.message}`);
  }
  return { written: writable.length, conflicts };
}

/** Park an entity we refuse to guess at, so an admin can resolve it. */
export async function recordUnresolved(entities: UnresolvedEntity[]): Promise<void> {
  if (entities.length === 0) return;
  const rows = entities.map((e) => ({
    source: e.source,
    entity_type: e.entityType,
    external_id: e.externalId,
    label: e.label,
    context: { reason: e.reason, ...(e.payload ?? {}) },
    resolved: false,
  }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabaseAdmin
      .from("unresolved_source_entities")
      .upsert(rows.slice(i, i + 200), { onConflict: "source,entity_type,external_id" });
    if (error) throw new Error(`identity: unresolved upsert failed — ${error.message}`);
  }
}

/** Mark previously unresolved entities as handled. */
export async function clearUnresolved(
  source: ImportSource,
  entityType: EntityType,
  externalIds: string[],
): Promise<void> {
  const ids = [...new Set(externalIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabaseAdmin
      .from("unresolved_source_entities")
      .update({ resolved: true })
      .eq("source", source)
      .eq("entity_type", entityType)
      .in("external_id", ids.slice(i, i + 200));
    if (error) throw new Error(`identity: unresolved clear failed — ${error.message}`);
  }
}
