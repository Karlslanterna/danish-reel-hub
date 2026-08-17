/**
 * Europe/Copenhagen <-> UTC helpers.
 *
 * `screenings.starts_at` is the canonical instant. Local date/time are only a
 * derived projection used for display and filtering, so all conversion lives
 * in one pure, testable place (DST included).
 */

export const CINEMA_TIME_ZONE = "Europe/Copenhagen";

const FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: CINEMA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

type Parts = { date: string; time: string; seconds: string };

function localParts(utcMs: number): Parts {
  const map: Record<string, string> = {};
  for (const p of FMT.formatToParts(new Date(utcMs))) map[p.type] = p.value;
  const hour = map.hour === "24" ? "00" : map.hour;
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    time: `${hour}:${map.minute}`,
    seconds: map.second ?? "00",
  };
}

/** Local date (YYYY-MM-DD) and time (HH:MM) in Copenhagen for an instant. */
export function copenhagenParts(iso: string | Date): { date: string; time: string } {
  const ms = iso instanceof Date ? iso.getTime() : Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`invalid timestamp: ${String(iso)}`);
  const { date, time } = localParts(ms);
  return { date, time };
}

function offsetMinutes(utcMs: number): number {
  const { date, time, seconds } = localParts(utcMs);
  const asUtc = Date.parse(`${date}T${time}:${seconds}Z`);
  return (asUtc - utcMs) / 60_000;
}

/**
 * Convert a Copenhagen wall-clock date + time to the exact UTC instant.
 * Two passes settle the DST boundary; ambiguous autumn hours resolve to the
 * first (summer-time) occurrence, which is what ticket systems mean.
 */
export function copenhagenToUtcIso(date: string, time: string): string {
  const naive = Date.parse(`${date}T${time.length === 5 ? time : time.slice(0, 5)}:00Z`);
  if (!Number.isFinite(naive)) throw new Error(`invalid local datetime: ${date} ${time}`);
  let utc = naive - offsetMinutes(naive) * 60_000;
  utc = naive - offsetMinutes(utc) * 60_000;
  return new Date(utc).toISOString();
}
