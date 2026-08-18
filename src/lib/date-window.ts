/**
 * Site-wide visible date window: today through today + 30 days.
 * The upcoming data stream only guarantees this range, so every query,
 * filter and date picker must stay inside it.
 */
export const DATE_WINDOW_DAYS = 30;

const CINEMA_TIME_ZONE = "Europe/Copenhagen";

const CINEMA_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: CINEMA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Calendar date in Denmark for an instant, independent of server/user timezone. */
export function cinemaDate(now: Date = new Date()): string {
  const parts: Record<string, string> = {};
  for (const part of CINEMA_DATE_FORMAT.formatToParts(now)) parts[part.type] = part.value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Add whole calendar days to a YYYY-MM-DD value without host-timezone drift. */
export function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days, 12));
  return value.toISOString().slice(0, 10);
}

/** First selectable/visible date in the Danish cinema timezone. */
export function windowStart(now: Date = new Date()): string {
  return cinemaDate(now);
}

/** Last selectable/visible Danish date, inclusive. */
export function windowEnd(now: Date = new Date()): string {
  return addCalendarDays(windowStart(now), DATE_WINDOW_DAYS);
}

const localDateObject = (date: string): Date => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
};

/** Date-only objects for the calendar, derived from Danish date boundaries. */
export function windowBounds(now: Date = new Date()): { from: Date; to: Date } {
  const from = localDateObject(windowStart(now));
  const to = localDateObject(windowEnd(now));
  return { from, to };
}

export function isWithinWindow(date: string): boolean {
  return date >= windowStart() && date <= windowEnd();
}
