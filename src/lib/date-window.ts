/**
 * Site-wide visible date window: today through today + 30 days.
 * The upcoming data stream only guarantees this range, so every query,
 * filter and date picker must stay inside it.
 */
export const DATE_WINDOW_DAYS = 30;

const iso = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/** First selectable/visible date (local time). */
export function windowStart(): string {
  return iso(new Date());
}

/** Last selectable/visible date (local time), inclusive. */
export function windowEnd(): string {
  const d = new Date();
  d.setDate(d.getDate() + DATE_WINDOW_DAYS);
  return iso(d);
}

/** Date-only Date objects, handy for calendar `disabled` bounds. */
export function windowBounds(): { from: Date; to: Date } {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + DATE_WINDOW_DAYS);
  return { from, to };
}

export function isWithinWindow(date: string): boolean {
  return date >= windowStart() && date <= windowEnd();
}
