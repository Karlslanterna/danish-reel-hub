import type { QueryClient } from "@tanstack/react-query";
import {
  fetchCinemas,
  fetchMovies,
  fetchShowtimeIndex,
  fetchTopCinemas,
  type Cinema,
  type Movie,
  type ShowtimeIndexRow,
} from "@/lib/cinema-data";
import {
  compactShowtimeIndex,
  expandShowtimeIndex,
  remapShowtimeIndexToMovies,
  type CompactShowtimeIndex,
} from "@/lib/public-catalog";
import { sortConsolidatedMovies } from "@/lib/movie-sort";
import {
  applyPhysicalScreeningStatsFromIndex,
  fetchPhysicallyRankedMovies,
  fetchPhysicallyRankedTopMovies,
} from "@/lib/physical-movie-ranking";
import { isMovieForChildren } from "@/lib/children-filter";
import {
  fetchChildrenScreeningSignals,
  type ChildScreeningSignal,
} from "@/lib/children-screening-signals";
import type { SpecialEventTag } from "@/lib/special-events";
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

function warmHomeCatalog(): Promise<HomeCatalogData> | null {
  return homeCatalogCache && homeCatalogCache.expiresAt > Date.now()
    ? homeCatalogCache.promise
    : null;
}

function boundedFilteredShell(
  catalog: HomeCatalogData,
  matchingMovies: Movie[],
): HomeCatalogData {
  const movies = matchingMovies.slice(0, HOME_SHELL_MOVIE_COUNT);
  return {
    movies: movies.map(compactMovieForHome),
    // The cinema section is secondary on these landings. Keeping only a bounded
    // first set prevents venue metadata from re-inflating the first HTML payload;
    // the complete catalogue replaces it on interaction / deferred hydration.
    cinemas: catalog.cinemas.slice(0, HOME_SHELL_CINEMA_COUNT).map(compactCinemaForHome),
    // The server has already validated which movies belong on this landing.
    // HomePage deliberately does not filter an incomplete shell, so serializing
    // those films' entire 30-day showtime history only delays the first poster/LCP.
    // Route head() functions treat `complete:false` movies as the validated set.
    showtimeIndex: compactShowtimeIndex([]),
    complete: false,
    totalMovies: matchingMovies.length,
    totalCinemas: catalog.totalCinemas,
  };
}

/**
 * Build the first-paint `/for-boern` payload from an already loaded national
 * catalogue. Classification uses the exact same movie + screening signals as
 * the full interactive page, but only the first 12 validated movie cards are
 * serialized to the browser.
 */
export function buildChildrenHomeShell(catalog: HomeCatalogData): HomeCatalogData {
  const rows = expandShowtimeIndex(catalog.showtimeIndex);
  const byMovie = new Map<string, ShowtimeIndexRow[]>();
  for (const row of rows) {
    const group = byMovie.get(row.movieId) ?? [];
    group.push(row);
    byMovie.set(row.movieId, group);
  }
  const matchingMovies = catalog.movies.filter((movie) =>
    isMovieForChildren(movie, byMovie.get(movie.id) ?? []),
  );
  return boundedFilteredShell(catalog, matchingMovies);
}

const sourceIdsForMovie = (movie: Movie): string[] =>
  movie.sourceIds?.length ? movie.sourceIds : [movie.id];

/**
 * Build the same bounded children shell from narrow source-level screening
 * signals. This is equivalent to classifying against the full remapped index:
 * only `events` and `languages` are consumed by `isMovieForChildren`.
 */
export function buildChildrenHomeShellFromSignals(
  movies: Movie[],
  cinemas: Cinema[],
  signals: ChildScreeningSignal[],
): HomeCatalogData {
  const signalBySourceMovie = new Map(signals.map((signal) => [signal.movieId, signal] as const));
  const matchingMovies = movies.filter((movie) =>
    isMovieForChildren(
      movie,
      sourceIdsForMovie(movie).flatMap((sourceId) => {
        const signal = signalBySourceMovie.get(sourceId);
        return signal ? [signal] : [];
      }),
    ),
  );

  return boundedFilteredShell(
    {
      movies,
      cinemas,
      showtimeIndex: compactShowtimeIndex([]),
      complete: false,
      totalMovies: movies.length,
      totalCinemas: cinemas.length,
    },
    matchingMovies,
  );
}

/**
 * Build a bounded first-paint payload for one curated/sourced special programme.
 * The complete canonical index is consulted server-side to identify the films;
 * the resulting validated movie slice is sufficient for first paint and SEO.
 */
export function buildSpecialEventHomeShell(
  catalog: HomeCatalogData,
  tag: SpecialEventTag,
): HomeCatalogData {
  const eventRows = expandShowtimeIndex(catalog.showtimeIndex).filter((row) =>
    row.events.includes(tag),
  );
  const movieIds = new Set(eventRows.map((row) => row.movieId));
  const matchingMovies = catalog.movies.filter((movie) => movieIds.has(movie.id));
  return boundedFilteredShell(catalog, matchingMovies);
}

/**
 * Fast SSR shell for the national children landing. Physical ranking stays
 * exact, but a cold first paint no longer waits for the national 30-day
 * showtime index. Warm navigations still reuse a complete catalogue if one is
 * already cached, preserving the instant filter-toggle path.
 */
export async function loadChildrenHomeShell(): Promise<HomeCatalogData> {
  const warmCatalog = warmHomeCatalog();
  if (warmCatalog) return buildChildrenHomeShell(await warmCatalog);

  const moviesPromise = fetchPhysicallyRankedMovies();
  const cinemasPromise = fetchCinemas();
  const movies = await moviesPromise;
  const signalMovieIds = [
    ...new Set(
      movies
        .filter((movie) => !isMovieForChildren(movie))
        .flatMap((movie) => sourceIdsForMovie(movie)),
    ),
  ];
  const signalsPromise = fetchChildrenScreeningSignals(signalMovieIds);
  const [cinemas, signals] = await Promise.all([cinemasPromise, signalsPromise]);
  return buildChildrenHomeShellFromSignals(movies, cinemas, signals);
}

/** Fast SSR shell for Babybio/Seniorbio/Filmporten/Biografklub Danmark landings. */
export async function loadSpecialEventHomeShell(tag: SpecialEventTag): Promise<HomeCatalogData> {
  return buildSpecialEventHomeShell(await loadHomeCatalog(), tag);
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
