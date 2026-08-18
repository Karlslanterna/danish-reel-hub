import type { Showtime } from "@/lib/cinema-data";
import { showtimeMatchesTags, type TagSelection } from "@/lib/showtime-tags";

export type CinemaProgramFilters = TagSelection & {
  date: string | null;
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
    const movieShowtimes = byMovie.get(showtime.movieId) ?? [];
    movieShowtimes.push(showtime);
    byMovie.set(showtime.movieId, movieShowtimes);
  }

  return byMovie;
}

/** Keep dates explicit when several programme days are visible at once. */
export function groupCinemaShowtimesByDate(
  showtimes: Showtime[],
): Array<{ date: string; showtimes: Showtime[] }> {
  const byDate = new Map<string, Showtime[]>();
  for (const showtime of showtimes) {
    const dateShowtimes = byDate.get(showtime.date) ?? [];
    dateShowtimes.push(showtime);
    byDate.set(showtime.date, dateShowtimes);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dateShowtimes]) => ({ date, showtimes: dateShowtimes }));
}
