import { supabase } from "@/integrations/supabase/client";
import { fetchMovies, fetchTopMovies, type Movie, type ShowtimeIndexRow } from "@/lib/cinema-data";
import { sortConsolidatedMovies } from "@/lib/movie-sort";
import { windowEnd } from "@/lib/date-window";

const CACHE_TTL_MS = 5 * 60 * 1000;
const SHELL_CANDIDATE_MULTIPLIER = 4;
const MAX_SHELL_CANDIDATES = 200;
const PHYSICAL_STATS_BATCH_SIZE = 200;

type PhysicalStatRow = {
  public_id: string;
  screening_count: number | string;
  next_screening_date: string | null;
};

type PhysicalStatsRpcResult = {
  data: PhysicalStatRow[] | null;
  error: { code?: string; message?: string } | null;
};

type PhysicalStatsRpcClient = {
  rpc: (
    name: "get_public_movie_physical_stats",
    args: { p_groups: Array<{ id: string; sourceIds: string[] }>; p_last_date: string },
  ) => PromiseLike<PhysicalStatsRpcResult>;
};

const isMissingStatsRpc = (error: PhysicalStatsRpcResult["error"]): boolean => {
  if (!error) return false;
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    /get_public_movie_physical_stats|schema cache|function.*not found|does not exist/iu.test(
      error.message ?? "",
    )
  );
};

/**
 * Count one public screening for each movie + physical cinema + advertised start
 * time. The showtime index may contain the same time in more than one source or
 * tag group; those rows must not inflate popularity.
 */
export function applyPhysicalScreeningStatsFromIndex<T extends Movie>(
  movies: T[],
  showtimes: ShowtimeIndexRow[],
): T[] {
  const stats = new Map<string, { keys: Set<string>; next: string | null }>();

  for (const row of showtimes) {
    const stat = stats.get(row.movieId) ?? { keys: new Set<string>(), next: null };
    for (const time of row.times) stat.keys.add(`${row.cinemaId}|${row.date}|${time}`);
    if (!stat.next || row.date < stat.next) stat.next = row.date;
    stats.set(row.movieId, stat);
  }

  return movies.map((movie) => {
    const stat = stats.get(movie.id);
    return {
      ...movie,
      screeningCount: stat?.keys.size ?? 0,
      nextScreeningDate: stat?.next ?? null,
    };
  });
}

/**
 * Re-count a caller-supplied public movie set by deduplicated physical
 * screenings. Keeping this helper public lets bounded SSR landings re-rank one
 * candidate batch without first loading/ranking the complete national catalog.
 */
export async function fetchPhysicalScreeningStats<T extends Movie>(movies: T[]): Promise<T[]> {
  if (movies.length === 0) return movies;
  const client = supabase as unknown as PhysicalStatsRpcClient;
  const allStats: PhysicalStatRow[] = [];

  for (let index = 0; index < movies.length; index += PHYSICAL_STATS_BATCH_SIZE) {
    const batch = movies.slice(index, index + PHYSICAL_STATS_BATCH_SIZE);
    const groups = batch.map((movie) => ({
      id: movie.id,
      sourceIds: movie.sourceIds?.length ? movie.sourceIds : [movie.id],
    }));
    const { data, error } = await client.rpc("get_public_movie_physical_stats", {
      p_groups: groups,
      p_last_date: windowEnd(),
    });

    // Deployment-order fallback only. Once the migration is live, a real RPC
    // failure must surface rather than silently re-introducing raw-source counts.
    if (error && isMissingStatsRpc(error)) return movies;
    if (error) throw error;
    allStats.push(...(data ?? []));
  }

  const byId = new Map(
    allStats.map((row) => [
      row.public_id,
      {
        count: Number(row.screening_count) || 0,
        next: row.next_screening_date,
      },
    ] as const),
  );

  return movies.map((movie) => {
    const stat = byId.get(movie.id);
    return {
      ...movie,
      screeningCount: stat?.count ?? 0,
      nextScreeningDate: stat?.next ?? null,
    };
  });
}

let fullCache: { expiresAt: number; promise: Promise<Movie[]> } | null = null;

/** Full public movie catalogue ordered by deduplicated physical screenings. */
export async function fetchPhysicallyRankedMovies(): Promise<Movie[]> {
  const now = Date.now();
  if (fullCache && fullCache.expiresAt > now) return fullCache.promise;

  const promise = (async () => {
    const movies = await fetchMovies();
    const withStats = await fetchPhysicalScreeningStats(movies);
    return sortConsolidatedMovies(
      withStats.filter((movie) => (movie.screeningCount ?? 0) > 0),
      "most-screenings",
    );
  })();
  fullCache = { expiresAt: now + CACHE_TTL_MS, promise };
  try {
    return await promise;
  } catch (error) {
    if (fullCache?.promise === promise) fullCache = null;
    throw error;
  }
}

/**
 * Bounded homepage ranking. Oversample the old ranking, then re-rank that
 * candidate set by exact public physical-screening counts. This keeps the SSR
 * payload bounded while preventing eBillet/Kultunaut overlap from deciding the
 * first cards.
 */
export async function fetchPhysicallyRankedTopMovies(
  limit: number,
): Promise<{ movies: Movie[]; total: number }> {
  const candidateLimit = Math.min(
    MAX_SHELL_CANDIDATES,
    Math.max(limit, limit * SHELL_CANDIDATE_MULTIPLIER),
  );
  const candidates = await fetchTopMovies(candidateLimit);
  const withStats = await fetchPhysicalScreeningStats(candidates.movies);
  const movies = sortConsolidatedMovies(
    withStats.filter((movie) => (movie.screeningCount ?? 0) > 0),
    "most-screenings",
  ).slice(0, limit);
  return { movies, total: candidates.total };
}
