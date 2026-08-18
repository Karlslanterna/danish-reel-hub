import type { Showtime } from "@/lib/cinema-data";
import { showtimeMatchesTags, type TagSelection } from "@/lib/showtime-tags";
import { timeKey } from "@/lib/showtime-sort";
import { filterShowtimeTimesByPeriod, type TimePeriod } from "@/lib/time-filter";

export type CinemaProgramFilters = TagSelection & {
  date: string | null;
  time?: TimePeriod | null;
};

/**
 * Build the cinema programme shown to the user.
 *
 * No selected date means the complete current programme window. A date only
 * becomes restrictive after the user explicitly selects one.
 */
export function cinemaProgramShowtimesByMovie(
  showtimes: Showtime[],
  filters: CinemaProgramFilters,
): Map<string, Showtime[]> {
  const byMovie = new Map<string, Showtime[]>();

  for (const showtime of showtimes) {
    if (filters.date && showtime.date !== filters.date) continue;
    if (!showtimeMatchesTags(showtime, filters)) continue;
    const visibleShowtime = filters.time
      ? filterShowtimeTimesByPeriod(showtime, filters.time)
      : showtime;
    if (!visibleShowtime) continue;
    const movieShowtimes = byMovie.get(showtime.movieId) ?? [];
    movieShowtimes.push(visibleShowtime);
    byMovie.set(showtime.movieId, movieShowtimes);
  }

  return byMovie;
}

/** Keep dates explicit when several programme days are visible at once. */
export function groupCinemaShowtimesByDate(showtimes: Showtime[]): Array<{
  date: string;
  showtimes: Showtime[];
  slots: Array<{ time: string; url: string | null; hall: string }>;
}> {
  const byDate = new Map<string, Showtime[]>();
  for (const showtime of showtimes) {
    const dateShowtimes = byDate.get(showtime.date) ?? [];
    dateShowtimes.push(showtime);
    byDate.set(showtime.date, dateShowtimes);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dateShowtimes]) => {
      // The same physical screening can arrive from both Kultunaut and
      // eBillet after duplicate cinema/movie records are consolidated. Since
      // the UI does not expose halls, identical time buttons are ambiguous and
      // provide no value. Keep one button and prefer the source with a working
      // ticket URL. This also keeps genuinely simultaneous auditorium listings
      // usable instead of rendering indistinguishable duplicate controls.
      const slotsByTime = new Map<string, { time: string; url: string | null; hall: string }>();
      for (const showtime of dateShowtimes) {
        showtime.times.forEach((time, index) => {
          const incoming = {
            time,
            url: showtime.ticketUrls?.[index] || showtime.bookingUrl || null,
            hall: showtime.hall,
          };
          const current = slotsByTime.get(time);
          if (!current || (!current.url && incoming.url)) slotsByTime.set(time, incoming);
        });
      }

      return {
        date,
        showtimes: dateShowtimes,
        slots: [...slotsByTime.values()].sort(
          (a, b) => timeKey(a.time) - timeKey(b.time) || a.hall.localeCompare(b.hall, "da"),
        ),
      };
    });
}
