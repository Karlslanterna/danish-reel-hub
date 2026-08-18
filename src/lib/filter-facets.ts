import { timePeriodForTime, type TimePeriod } from "@/lib/time-filter";

type FacetRow = {
  movieId: string;
  cinemaId: string;
  date: string;
  times: string[];
  formats: string[];
  languages: string[];
  events: string[];
};

type FacetMovie = { id: string; genre: string[] };

export type FacetSelection = {
  baseCinemaIds?: ReadonlySet<string> | null;
  cinemaIds?: ReadonlySet<string> | null;
  baseMovieIds?: ReadonlySet<string> | null;
  date?: string | null;
  time?: TimePeriod | null;
  genre?: string | null;
  format?: string | null;
  language?: string | null;
  event?: string | null;
};

type Dimension = "cinema" | "date" | "time" | "genre" | "format" | "language" | "event";

const matches = (
  row: FacetRow,
  movie: FacetMovie | undefined,
  selection: FacetSelection,
  omit?: Dimension,
) => {
  if (selection.baseMovieIds && !selection.baseMovieIds.has(row.movieId)) return false;
  if (selection.baseCinemaIds && !selection.baseCinemaIds.has(row.cinemaId)) return false;
  if (omit !== "cinema" && selection.cinemaIds && !selection.cinemaIds.has(row.cinemaId))
    return false;
  if (omit !== "date" && selection.date && row.date !== selection.date) return false;
  if (
    omit !== "time" &&
    selection.time &&
    !row.times.some((time) => timePeriodForTime(time) === selection.time)
  )
    return false;
  if (omit !== "genre" && selection.genre && !movie?.genre.includes(selection.genre)) return false;
  if (omit !== "format" && selection.format && !row.formats.includes(selection.format))
    return false;
  if (omit !== "language" && selection.language && !row.languages.includes(selection.language))
    return false;
  if (omit !== "event" && selection.event && !row.events.includes(selection.event)) return false;
  return true;
};

/**
 * Faceted options use every active filter except their own dimension. This
 * prevents dead menu choices without making the currently selected value
 * impossible to remove.
 */
export function buildFilterFacets(
  rows: FacetRow[],
  movies: FacetMovie[],
  selection: FacetSelection,
) {
  const movieById = new Map(movies.map((movie) => [movie.id, movie]));
  const dates = new Set<string>();
  const times = new Set<TimePeriod>();
  const genres = new Set<string>();
  const formats = new Set<string>();
  const languages = new Set<string>();
  const events = new Set<string>();
  const cinemaIds = new Set<string>();

  for (const row of rows) {
    const movie = movieById.get(row.movieId);
    if (matches(row, movie, selection, "date")) dates.add(row.date);
    if (matches(row, movie, selection, "time")) {
      for (const value of row.times) {
        const period = timePeriodForTime(value);
        if (period) times.add(period);
      }
    }
    if (matches(row, movie, selection, "genre")) {
      for (const value of movie?.genre ?? []) genres.add(value);
    }
    if (matches(row, movie, selection, "format")) {
      for (const value of row.formats) formats.add(value);
    }
    if (matches(row, movie, selection, "language")) {
      for (const value of row.languages) languages.add(value);
    }
    if (matches(row, movie, selection, "event")) {
      for (const value of row.events) events.add(value);
    }
    if (matches(row, movie, selection, "cinema")) cinemaIds.add(row.cinemaId);
  }

  const order: TimePeriod[] = ["morning", "afternoon", "evening", "late"];
  return {
    dates: [...dates].sort(),
    times: order.filter((value) => times.has(value)),
    genres: [...genres].sort((a, b) => a.localeCompare(b, "da")),
    formats: [...formats],
    languages: [...languages],
    events: [...events],
    cinemaIds,
  };
}
