import type { CanonicalPipelineHealth, SourcePipelineHealth } from "./health.server";

export const OPERATIONAL_STALE_HOURS = 26;

function sourceOperationalFailures(source: SourcePipelineHealth): string[] {
  const label = source.source === "ebillet" ? "eBillet" : "Kultunaut";
  const failures: string[] = [];

  if (!source.lastSuccessAt || source.hoursSinceLastSuccess === null) {
    failures.push(`${label}: no completed canonical import is recorded`);
  } else if (source.hoursSinceLastSuccess >= OPERATIONAL_STALE_HOURS) {
    failures.push(
      `${label}: last canonical success was ${source.hoursSinceLastSuccess.toFixed(1)}h ago`,
    );
  }

  if (source.deadLetterRuns > 0) {
    failures.push(`${label}: ${source.deadLetterRuns} unresolved dead-letter scope(s)`);
  }

  if (source.canonicalScreenings === 0) {
    failures.push(`${label}: zero canonical screenings`);
  } else if (source.futureScreenings === 0) {
    failures.push(`${label}: zero future canonical screenings`);
  }

  return failures;
}

/**
 * Operational monitoring is intentionally stricter than the public platform
 * headline. The platform may remain usable when one secondary source is stale,
 * but operators still need a failing signal for that source. Unresolved entity
 * mappings alone do not page: they are data-quality warnings, not proof that an
 * importer stopped running.
 */
export function operationalImportFailures(health: CanonicalPipelineHealth): string[] {
  return [health.sources.ebillet, health.sources.kultunaut].flatMap(sourceOperationalFailures);
}
