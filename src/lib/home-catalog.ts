import type { QueryClient } from "@tanstack/react-query";
import {
  fetchCinemas,
  fetchMovies,
  fetchShowtimeIndex,
  fetchTopCinemas,
  type Cinema,
  type Movie,
} from "@/lib/cinema-data";
import {
  compactShowtimeIndex,
  remapShowtimeIndexToMovies,
  type CompactShowtimeIndex,
} from "@/lib/public-catalog";
import { sortConsolidatedMovies } from "@/lib/movie-sort";
import {
  applyPhysicalScreeningStatsFromIndex,
  fetchPhysicallyRankedTopMovies,
} from "@/lib/physical-movie-ranking";
import { HOME_CATALOG_QUERY_KEY } from "@/lib/home-catalog-cache";

/** Cards rendered before the visitor scrolls or interacts. */
export const HOME_SHELL_MOVIE_COUNT = 12;
export const HOME_SHELL_CINEMA_COUNT = 24;

export type HomeCatalogData = {
  movies: Movie[];
  cinemas: Cinema[];
  showtimeIndex: CompactShowtimeIndex;
  /**
   * `false` while only the bounded first-paint slice is available. Filtering,
   * search and zero-result analytics must wait for the complete catalogue.
   */
  complete: boolean;
  totalMovies: number;
  totalCinemas: number;
};

const HOME_CATALOG_TTL_MS = 5 * 60 * 1000;
let homeCatalogCache: { expiresAt: number; promise: Promise<HomeCatalogData> } | null = null;

export const compactCinemaForHome = (cinema: Cinema): Cinema =>
  ({
    id: cinema.id,
    slug: cinema.slug,
    name: cinema.name,
    city: cinema.city,
    screens: cinema.screens,
    latitude: cinema.latitude,
    longitude: cinema.longitude,
  }) as Cinema;

export const compactMovieForHome = (movie: Movie): Movie => {
  const { sourceSlugs: _sourceSlugs, ...compact } = movie;
  return compact;
};

/**
 * Bounded SSR payload for `/`: the movie and cinema cards that are actually
 * rendered on first paint, and nothing else. No national showtime index is
 * read here — it is the single largest part of the catalogue and only filters
 * and search need it, both of which wait for the complete catalogue.
 *
 * Ranking is still based on physical screenings: a small oversampled candidate
 * set is re-counted by the physical-stats RPC before the first 12 cards are
 * selected, so cross-source overlap cannot decide the initial order.
 */
export async function loadHomeShell(): Promise<HomeCatalogData> {
  const [movies, cinemas] = await Promise.all([
    fetchPhysicallyRankedTopMovies(HOME_SHELL_MOVIE_COUNT),
    fetchTopCinemas(HOME_SHELL_CINEMA_COUNT),
  ]);
  return {
    movies: movies.movies.map(compactMovieForHome),
    cinemas: cinemas.cinemas.map(compactCinemaForHome),
    showtimeIndex: compactShowtimeIndex([]),
    complete: false,
    // Source-row counts: cheap (same query), and only used for the headline
    // totals until the consolidated catalogue replaces them.
    totalMovies: movies.total,
    totalCinemas: cinemas.total,
  };
}

/** The complete national catalogue used by filters, search and SEO routes. */
export async function loadHomeCatalog(): Promise<HomeCatalogData> {
  const now = Date.now();
  if (homeCatalogCache && homeCatalogCache.expiresAt > now) return homeCatalogCache.promise;

  const promise = (async () => {
    const [rawMovies, cinemas, rawShowtimeIndex] = await Promise.all([
      fetchMovies(),
      fetchCinemas(),
      fetchShowtimeIndex(),
    ]);
    const showtimeIndex = remapShowtimeIndexToMovies(rawShowtimeIndex, rawMovies);
    const movies = sortConsolidatedMovies(
      applyPhysicalScreeningStatsFromIndex(rawMovies, showtimeIndex).filter(
        (movie) => (movie.screeningCount ?? 0) > 0,
      ),
      "most-screenings",
    );
    return {
      movies: movies.map(compactMovieForHome),
      cinemas: cinemas.map(compactCinemaForHome),
      showtimeIndex: compactShowtimeIndex(showtimeIndex),
      complete: true,
      totalMovies: movies.length,
      totalCinemas: cinemas.length,
    };
  })();
  homeCatalogCache = { expiresAt: now + HOME_CATALOG_TTL_MS, promise };
  try {
    return await promise;
  } catch (error) {
    if (homeCatalogCache?.promise === promise) homeCatalogCache = null;
    throw error;
  }
}

export function loadCachedHomeCatalog(queryClient: QueryClient): Promise<HomeCatalogData> {
  return queryClient.ensureQueryData({
    queryKey: HOME_CATALOG_QUERY_KEY,
    queryFn: loadHomeCatalog,
    staleTime: 5 * 60 * 1000,
    revalidateIfStale: true,
  });
}

export { HOME_CATALOG_QUERY_KEY };
