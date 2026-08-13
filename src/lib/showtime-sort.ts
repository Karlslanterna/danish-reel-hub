import type { Showtime } from "@/lib/cinema-data";

/**
 * Shared chronological sorting for showtimes.
 * Every view (movie, cinema, city, homepage, search) must use these helpers so
 * ordering is identical and never depends on database/insertion order.
 */

/** "2026-08-13" -> comparable number. Falls back to 0 for unparsable values. */
export function dateKey(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((date ?? "").trim());
  if (!m) return Number.MAX_SAFE_INTEGER;
  return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
}

/** "19:05" / "9.5" -> minutes since midnight. Unparsable sorts last. */
export function timeKey(time: string): number {
  const m = /(\d{1,2})[:.](\d{2})/.exec((time ?? "").trim());
  if (!m) return Number.MAX_SAFE_INTEGER;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Sorts a row's times ascending while keeping ticketUrls aligned per time. */
export function sortShowtimeTimes<T extends Showtime>(s: T): T {
  const pairs = (s.times ?? []).map((t, i) => ({ t, u: s.ticketUrls?.[i] }));
  pairs.sort((a, b) => timeKey(a.t) - timeKey(b.t));
  const hasUrls = (s.ticketUrls?.length ?? 0) > 0;
  return {
    ...s,
    times: pairs.map((p) => p.t),
    ticketUrls: hasUrls ? pairs.map((p) => p.u ?? "") : (s.ticketUrls ?? []),
  };
}

/** Sorts rows by date ascending, then by earliest time, then hall. */
export function sortShowtimes<T extends Showtime>(rows: T[]): T[] {
  return rows
    .map((r) => sortShowtimeTimes(r))
    .sort((a, b) => {
      const d = dateKey(a.date) - dateKey(b.date);
      if (d !== 0) return d;
      const t = timeKey(a.times?.[0] ?? "") - timeKey(b.times?.[0] ?? "");
      if (t !== 0) return t;
      return (a.hall ?? "").localeCompare(b.hall ?? "", "da");
    });
}
