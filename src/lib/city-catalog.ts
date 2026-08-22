import { supabase } from "@/integrations/supabase/client";
import {
  fetchCinemas,
  fetchMovies,
  fetchMoviesAndShowtimeIndexForCinemas,
  type Cinema,
  type Movie,
} from "@/lib/cinema-data";
import { canonicalCinemaId, expandCinemaIds } from "@/lib/cinema-catalog";
import {
  baseCityOf,
  cityMatchesSlug,
  cityOptionsFrom,
  citySlug,
  type CityOption,
} from "@/lib/city-slug";
import { sortConsolidatedMovies } from "@/lib/movie-sort";
import { compactShowtimeIndex, type CompactShowtimeIndex } from "@/lib/public-catalog";
import { windowEnd, windowStart } from "@/lib/date-window";

/** The city grid never renders more than this many cards before interaction. */
export const CITY_SHELL_MOVIE_COUNT = 40;
/**
 * Hard ceiling for the narrow physical-screening sample used to choose the
 * first city cards. København currently has ~2,500 physical screenings in the
 * 30-day window; the shell reads at most 1,000 four-column rows and serializes
 * none of them to the browser.
 */
export const CITY_SHELL_SCREENING_LIMIT = 1_000;

export const cityCatalogQueryKey = (canonicalSlug: string) =>
  ["city-catalog", canonicalSlug] as const;

export type CityCatalogData = {
  cityName: string;
  canonicalSlug: string;
  cinemas: Cinema[];
  movies: Movie[];
  showtimes: CompactShowtimeIndex;
  otherCities: CityOption[];
  /** `false` while only the bounded first-paint city shell is available. */
  complete: boolean;
  /** Exact on the full catalogue; a lower bound while a shell sample hit its cap. */
  totalMovies: number;
  totalMoviesExact: boolean;
  hasScreenings: boolean;
};

export type CityShellScreeningRow = {
  movie_id: string;
  cinema_id: string;
  starts_at: string;
  local_date: string;
};

type CityContext = {
  cinemas: Cinema[];
  cityName: string;
  canonicalSlug: string;
  otherCities: CityOption[];
};

async function loadCityContext(cityParam: string): Promise<CityContext | null> {
  const slug = cityParam.toLowerCase();
  const allCinemas = await fetchCinemas();
  const cinemas = allCinemas.filter((cinema) => cityMatchesSlug(cinema.city, slug));
  if (cinemas.length === 0) return null;

  const cityName = baseCityOf(cinemas[0]!.city);
  const canonicalSlug = citySlug(cinemas[0]!.city);
  const otherCities = cityOptionsFrom(allCinemas).filter((city) => city.slug !== canonicalSlug);
  return { cinemas, cityName, canonicalSlug, otherCities };
}

async function fetchCityShellScreenings(cinemaIds: string[]): Promise<CityShellScreeningRow[]> {
  const sourceCinemaIds = expandCinemaIds(cinemaIds);
  const { data, error } = await supabase
    .from("screenings")
    .select("movie_id, cinema_id, starts_at, local_date")
    .in("cinema_id", sourceCinemaIds)
    .gte("starts_at", new Date().toISOString())
    .gte("local_date", windowStart())
    .lte("local_date", windowEnd())
    .order("starts_at", { ascending: true })
    .order("id", { ascending: true })
    .range(0, CITY_SHELL_SCREENING_LIMIT - 1)
    .returns<CityShellScreeningRow[]>();
  if (error) throw error;
  return data ?? [];
}

/**
 * Rank the bounded shell by the physical screenings present in its sample.
 * Source-overlap is collapsed to public movie + physical cinema + start time,
 * so eBillet/Kultunaut duplicates cannot manufacture popularity.
 */
export function buildCityShellMovies(
  movies: Movie[],
  rows: CityShellScreeningRow[],
  limit = CITY_SHELL_MOVIE_COUNT,
): { movies: Movie[]; candidateCount: number } {
  const sourceToPublic = new Map<string, string>();
  for (const movie of movies) {
    sourceToPublic.set(movie.id, movie.id);
    for (const sourceId of movie.sourceIds ?? []) sourceToPublic.set(sourceId, movie.id);
  }

  const seenPhysical = new Set<string>();
  const stats = new Map<string, { count: number; next: string | null }>();
  for (const row of rows) {
    const publicMovieId = sourceToPublic.get(row.movie_id);
    if (!publicMovieId) continue;
    const physicalKey = `${publicMovieId}|${canonicalCinemaId(row.cinema_id)}|${row.starts_at}`;
    if (seenPhysical.has(physicalKey)) continue;
    seenPhysical.add(physicalKey);

    const current = stats.get(publicMovieId) ?? { count: 0, next: null };
    current.count += 1;
    if (!current.next || row.local_date < current.next) current.next = row.local_date;
    stats.set(publicMovieId, current);
  }

  const ranked = sortConsolidatedMovies(
    movies
      .filter((movie) => stats.has(movie.id))
      .map((movie) => {
        const stat = stats.get(movie.id)!;
        return {
          ...movie,
          screeningCount: stat.count,
          nextScreeningDate: stat.next,
        };
      }),
    "most-screenings",
  ).slice(0, limit);

  return { movies: ranked, candidateCount: stats.size };
}

/**
 * Fast SSR data for a city landing. It keeps the full physical 30-day programme
 * out of first paint: only city cinemas, up to 40 ranked cards, and empty filter
 * data are serialized. The complete programme is fetched after hydration.
 */
export async function loadCityShellData(cityParam: string): Promise<CityCatalogData | null> {
  const context = await loadCityContext(cityParam);
  if (!context) return null;

  const [allMovies, screeningRows] = await Promise.all([
    fetchMovies(),
    fetchCityShellScreenings(context.cinemas.map((cinema) => cinema.id)),
  ]);
  const shell = buildCityShellMovies(allMovies, screeningRows);

  return {
    cityName: context.cityName,
    canonicalSlug: context.canonicalSlug,
    cinemas: context.cinemas,
    movies: shell.movies,
    showtimes: compactShowtimeIndex([]),
    otherCities: context.otherCities,
    complete: false,
    totalMovies: shell.candidateCount,
    totalMoviesExact: screeningRows.length < CITY_SHELL_SCREENING_LIMIT,
    hasScreenings: screeningRows.length > 0,
  };
}

/** Complete 30-day city catalogue used by filters and child-city SEO routes. */
export async function loadCityCatalogData(cityParam: string): Promise<CityCatalogData | null> {
  const context = await loadCityContext(cityParam);
  if (!context) return null;

  const { movies, showtimes } = await fetchMoviesAndShowtimeIndexForCinemas(
    context.cinemas.map((cinema) => cinema.id),
  );
  movies.sort((a, b) => a.title.localeCompare(b.title, "da"));

  return {
    cityName: context.cityName,
    canonicalSlug: context.canonicalSlug,
    cinemas: context.cinemas,
    movies,
    showtimes: compactShowtimeIndex(showtimes),
    otherCities: context.otherCities,
    complete: true,
    totalMovies: movies.length,
    totalMoviesExact: true,
    hasScreenings: showtimes.length > 0,
  };
}
