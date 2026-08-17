/**
 * Source-specific health for the canonical import pipeline.
 *
 * This deliberately does not infer eBillet health from Kultunaut jobs (or vice
 * versa). Each source gets its own run freshness, canonical screening count,
 * unresolved dead-letter scope count and unresolved identity count.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ImportSource } from "./types";

export type PipelineHealthStatus = "healthy" | "warning" | "critical" | "unknown";

export type SourcePipelineHealth = {
  source: ImportSource;
  status: PipelineHealthStatus;
  reasons: string[];
  lastRunAt: string | null;
  lastRunState: string | null;
  lastSuccessAt: string | null;
  hoursSinceLastSuccess: number | null;
  canonicalScreenings: number;
  futureScreenings: number;
  queuedRuns: number;
  runningRuns: number;
  deadLetterRuns: number;
  unresolvedMappings: number;
};

export type ScreeningParityHealth = {
  available: boolean;
  mismatchGroups: number;
  totalAbsoluteDelta: number;
  bySource: Record<ImportSource, { mismatchGroups: number; totalAbsoluteDelta: number }>;
  truncated: boolean;
};

export type CanonicalPipelineHealth = {
  status: PipelineHealthStatus;
  reasons: string[];
  sources: Record<ImportSource, SourcePipelineHealth>;
  parity: ScreeningParityHealth;
  checkedAt: string;
};

export type HealthRunRow = {
  state: string;
  scope_type: string;
  scope_key: string;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

type ParityRow = {
  source: string;
  cinema_id: string;
  screening_date: string;
  canonical_count: number | string;
  legacy_count: number | string;
  delta: number | string;
};

const WARN_HOURS = 26;
const CRITICAL_HOURS = 48;
const PARITY_LIMIT = 1000;

function maxStatus(a: PipelineHealthStatus, b: PipelineHealthStatus): PipelineHealthStatus {
  const rank: Record<PipelineHealthStatus, number> = {
    healthy: 0,
    unknown: 1,
    warning: 2,
    critical: 3,
  };
  return rank[a] >= rank[b] ? a : b;
}

/**
 * Count only dead-letter scopes whose newest run is still dead-lettered.
 * Historical dead letters are audit history, not an eternal outage: if the
 * same organizer/cinema later completes successfully, health must recover.
 */
export function unresolvedDeadLetterScopes(runs: HealthRunRow[]): number {
  const latest = new Map<string, HealthRunRow>();
  const ordered = [...runs].sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const run of ordered) {
    const key = `${run.scope_type}:${run.scope_key}`;
    if (!latest.has(key)) latest.set(key, run);
  }
  return [...latest.values()].filter((r) => r.state === "dead_letter").length;
}

/**
 * The parity view is transition-only and is intentionally not part of the
 * generated Supabase types. Keep this narrow structural cast local so the rest
 * of the database client remains fully typed.
 */
async function screeningParityHealth(): Promise<ScreeningParityHealth> {
  type ParityResult = { data: ParityRow[] | null; error: { message: string } | null };
  type ParityDb = {
    from: (table: "screening_model_parity") => {
      select: (columns: string) => {
        neq: (column: "delta", value: number) => {
          limit: (limit: number) => PromiseLike<ParityResult>;
        };
      };
    };
  };

  const db = supabaseAdmin as unknown as ParityDb;
  const { data, error } = await db
    .from("screening_model_parity")
    .select("source,cinema_id,screening_date,canonical_count,legacy_count,delta")
    .neq("delta", 0)
    .limit(PARITY_LIMIT);

  const empty = (): ScreeningParityHealth => ({
    available: false,
    mismatchGroups: 0,
    totalAbsoluteDelta: 0,
    bySource: {
      ebillet: { mismatchGroups: 0, totalAbsoluteDelta: 0 },
      kultunaut: { mismatchGroups: 0, totalAbsoluteDelta: 0 },
    },
    truncated: false,
  });

  // A deployment may briefly run code before the transition view migration is
  // applied. Health should remain available and explicitly say parity is not.
  if (error) return empty();

  const rows = data ?? [];
  const result: ScreeningParityHealth = {
    available: true,
    mismatchGroups: rows.length,
    totalAbsoluteDelta: 0,
    bySource: {
      ebillet: { mismatchGroups: 0, totalAbsoluteDelta: 0 },
      kultunaut: { mismatchGroups: 0, totalAbsoluteDelta: 0 },
    },
    truncated: rows.length >= PARITY_LIMIT,
  };

  for (const row of rows) {
    const delta = Math.abs(Number(row.delta) || 0);
    result.totalAbsoluteDelta += delta;
    if (row.source === "ebillet" || row.source === "kultunaut") {
      result.bySource[row.source].mismatchGroups += 1;
      result.bySource[row.source].totalAbsoluteDelta += delta;
    }
  }
  return result;
}

async function sourceHealth(source: ImportSource): Promise<SourcePipelineHealth> {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Copenhagen",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const [runsRes, canonicalRes, futureRes, queuedRes, runningRes, unresolvedRes] =
    await Promise.all([
      // 500 comfortably covers several complete cycles at current scale and
      // lets us determine whether an old dead letter has since recovered.
      supabaseAdmin
        .from("import_runs")
        .select("state,scope_type,scope_key,created_at,updated_at,finished_at")
        .eq("source", source)
        .order("created_at", { ascending: false })
        .limit(500),
      supabaseAdmin
        .from("screenings")
        .select("id", { count: "exact", head: true })
        .eq("source", source),
      supabaseAdmin
        .from("screenings")
        .select("id", { count: "exact", head: true })
        .eq("source", source)
        .gte("local_date", today),
      supabaseAdmin
        .from("import_runs")
        .select("id", { count: "exact", head: true })
        .eq("source", source)
        .eq("state", "queued"),
      supabaseAdmin
        .from("import_runs")
        .select("id", { count: "exact", head: true })
        .eq("source", source)
        .eq("state", "running"),
      supabaseAdmin
        .from("unresolved_source_entities")
        .select("id", { count: "exact", head: true })
        .eq("source", source)
        .eq("resolved", false),
    ]);

  for (const [label, result] of [
    ["runs", runsRes],
    ["screenings", canonicalRes],
    ["future screenings", futureRes],
    ["queued runs", queuedRes],
    ["running runs", runningRes],
    ["unresolved mappings", unresolvedRes],
  ] as const) {
    if (result.error) throw new Error(`${source} health ${label}: ${result.error.message}`);
  }

  const runs = (runsRes.data ?? []) as HealthRunRow[];
  const last = runs[0] ?? null;
  const success = runs.find((r) => r.state === "completed") ?? null;
  const successAt = success?.finished_at ?? success?.updated_at ?? null;
  const hoursSinceLastSuccess = successAt
    ? Math.max(0, (Date.now() - Date.parse(successAt)) / 3_600_000)
    : null;
  const canonicalScreenings = canonicalRes.count ?? 0;
  const futureScreenings = futureRes.count ?? 0;
  const deadLetterRuns = unresolvedDeadLetterScopes(runs);
  const reasons: string[] = [];
  let status: PipelineHealthStatus = "healthy";

  if (!last) {
    status = canonicalScreenings > 0 ? "warning" : "unknown";
    reasons.push("No canonical import runs recorded yet");
  }

  if (deadLetterRuns > 0) {
    status = "critical";
    reasons.push(`${deadLetterRuns} import scope(s) are unresolved in dead-letter state`);
  }

  if (hoursSinceLastSuccess === null) {
    if (canonicalScreenings > 0) {
      status = maxStatus(status, "warning");
      reasons.push("Canonical screenings exist, but no completed import_run is recorded yet");
    }
  } else if (hoursSinceLastSuccess >= CRITICAL_HOURS) {
    status = maxStatus(status, "critical");
    reasons.push(`Last canonical success was ${hoursSinceLastSuccess.toFixed(1)}h ago`);
  } else if (hoursSinceLastSuccess >= WARN_HOURS) {
    status = maxStatus(status, "warning");
    reasons.push(`Last canonical success was ${hoursSinceLastSuccess.toFixed(1)}h ago`);
  }

  // At source level, zero future screenings is a strong anomaly once the
  // source has previously produced canonical data.
  if (canonicalScreenings > 0 && futureScreenings === 0) {
    status = maxStatus(status, "critical");
    reasons.push("Source has canonical history but zero future screenings");
  }

  if ((unresolvedRes.count ?? 0) > 0) {
    status = maxStatus(status, "warning");
    reasons.push(`${unresolvedRes.count} unresolved identity mapping(s)`);
  }

  if (reasons.length === 0) reasons.push("All canonical source checks passed");

  return {
    source,
    status,
    reasons,
    lastRunAt: last?.created_at ?? null,
    lastRunState: last?.state ?? null,
    lastSuccessAt: successAt,
    hoursSinceLastSuccess,
    canonicalScreenings,
    futureScreenings,
    queuedRuns: queuedRes.count ?? 0,
    runningRuns: runningRes.count ?? 0,
    deadLetterRuns,
    unresolvedMappings: unresolvedRes.count ?? 0,
  };
}

export async function getCanonicalPipelineHealth(): Promise<CanonicalPipelineHealth> {
  const [ebillet, kultunaut, parity] = await Promise.all([
    sourceHealth("ebillet"),
    sourceHealth("kultunaut"),
    screeningParityHealth(),
  ]);

  // eBillet is the current primary operational feed. A Kultunaut outage is
  // surfaced separately and degrades an otherwise healthy platform to warning,
  // but does not page the whole service as critical while eBillet remains good.
  let status: PipelineHealthStatus = ebillet.status;
  const reasons = [...ebillet.reasons.map((r) => `eBillet: ${r}`)];
  if (kultunaut.status === "critical" && ebillet.status === "healthy") {
    status = "warning";
  } else if (kultunaut.status === "warning" && status === "healthy") {
    status = "warning";
  } else if (kultunaut.status === "unknown" && status === "healthy") {
    status = "warning";
  }
  reasons.push(...kultunaut.reasons.map((r) => `Kultunaut: ${r}`));

  // Parity mismatches are a migration warning, not a source outage. They block
  // retiring showtimes as a compatibility read model until investigated.
  if (parity.available && parity.mismatchGroups > 0) {
    status = maxStatus(status, "warning");
    reasons.push(
      `Screening parity: ${parity.mismatchGroups} group(s) differ by ${parity.totalAbsoluteDelta} physical screening(s)`,
    );
  }

  return {
    status,
    reasons,
    sources: { ebillet, kultunaut },
    parity,
    checkedAt: new Date().toISOString(),
  };
}
