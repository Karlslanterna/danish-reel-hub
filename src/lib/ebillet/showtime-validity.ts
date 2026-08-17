import { copenhagenToUtcIso } from "@/lib/pipeline/localtime";

export const EBILLET_MAX_PAST_DAYS = 400;
export const EBILLET_MAX_FUTURE_DAYS = 730;

/** Convert eBillet's Danish wall clock or explicit-offset timestamp to UTC. */
export function ebilletDateTimeToUtcIso(dateTime: string): string {
  const value = dateTime.trim();
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/u.test(value);
  if (hasZone) {
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) throw new Error(`Invalid eBillet dateTime: ${dateTime}`);
    return parsed.toISOString();
  }

  const match = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/u);
  if (!match) throw new Error(`Invalid eBillet dateTime: ${dateTime}`);
  return copenhagenToUtcIso(match[1]!, match[2]!);
}

/**
 * Accept a wide window for source reconciliation, but reject impossible stale
 * or far-future rows before they can become canonical screenings.
 */
export function isPlausibleEbilletDateTime(dateTime: string, now = new Date()): boolean {
  try {
    const ts = Date.parse(ebilletDateTimeToUtcIso(dateTime));
    if (!Number.isFinite(ts)) return false;
    const days = (ts - now.getTime()) / 86_400_000;
    return days >= -EBILLET_MAX_PAST_DAYS && days <= EBILLET_MAX_FUTURE_DAYS;
  } catch {
    return false;
  }
}
