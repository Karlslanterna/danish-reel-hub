import { supabase } from "@/integrations/supabase/client";
import { isPlaceholderPosterUrl, toHttpsUrl } from "@/lib/poster-url";
import {
  DEFAULT_MOVIE_SORT,
  MOVIE_SORT_ORDERS,
  sortConsolidatedMovies,
  type MovieSortStrategy,
} from "@/lib/movie-sort";
import { windowStart, windowEnd } from "@/lib/date-window";
import {
  isPublicMovieTitle,
  normalizePublicGenres,
  preparePublicMoviePosters,
  publicMovieDisplayTitle,
  resolvePublicMovieYear,
} from "@/lib/public-movie";
import {
  groupScreeningIndexForUi,
  groupScreeningsForUi,
  normalizeTicketUrl,
  type ScreeningIndexReadRow,
  type ScreeningReadRow,
  type UiShowtime,
  type UiShowtimeIndexRow,
} from "@/lib/screening-read-model";
import { sortShowtimes } from "@/lib/showtime-sort";
import {
  consolidatePublicMovies,
  remapShowtimeIndexToMovies,
  remapShowtimesToMovies,
} from "@/lib/public-catalog";
import {
  canonicalCinemaId,
  consolidatePublicCinemas,
  expandCinemaIds,
  remapScreeningCinemaIds,
} from "@/lib/cinema-catalog";

export type Poster = {
  a?: string;
  b?: string;
  c?: string;
  d?: string;
  url?: string;
  alt?: string;
  fit?: "cover" | "contain";
};

export type CastMember = { name: string; character?: string | null; profile_path?: string | null };

export type Movie = {
  id: string;
  slug: string;
  title: string;
  originalTitle?: string | null;
  runtime: number;
  genre: string[];
  year: number;
  director: string;
  rating: string;
  synopsis: string;
  poster: Poster;
  /** TMDb extras — always optional so the UI works on source data alone. */
  backdropUrl?: string | null;
  trailerUrl?: string | null;
  cast?: CastMember[];
  voteAverage?: number | null;
  /** Upcoming physical screenings across all cinemas. */
  screeningCount?: number;
  nextScreeningDate?: string | null;
  /** Used only to reject ambiguous source artwork at the public read boundary. */
  tmdbId?: number | null;
  posterSource?: "tmdb" | "source" | "programme" | null;
  /** All source rows represented by this public film card. */
  sourceIds?: string[];
  sourceSlugs?: string[];
};

export type Cinema = {
  id: string;
  slug: string;
  name: string;
  city: string;
  address: string;
  description: string;
  screens: number;
  latitude: number | null;
  longitude: number | null;
  website: string | null;
  /** All source rows represented by this physical public cinema. */
  sourceIds?: string[];
  sourceSlugs?: string[];
};

export type Showtime = UiShowtime;
export type ShowtimeIndexRow = UiShowtimeIndexRow;

type MovieRow = {
  id: string;
  slug: string;
  title: string;
  original_title: string | null;
  runtime: number;
  genre: string[];
  year: number;
  director: string;
  rating: string;
  synopsis: string;
  poster: unknown;
  tmdb_runtime?: number | null;
  tmdb_overview?: string | null;
  tmdb_genres?: string[] | null;
  tmdb_poster_url?: string | null;
  tmdb_backdrop_url?: string | null;
  tmdb_trailer_url?: string | null;
  tmdb_cast?: unknown;
  tmdb_director?: string | null;
  tmdb_vote_average?: number | string | null;
  tmdb_id?: number | null;
  screening_count?: number | string | null;
  next_screening_date?: string | null;
  source?: string | null;
  release_date?: string | null;
};

type CinemaRow = {
  id: string;
  slug: string;
  name: string;
  city: string;
  // Listing reads select a narrower column set, so these can be absent.
  address?: string | null;
  description?: string | null;
  screens?: number | null;
  latitude: number | null;
  longitude: number | null;
  website: string | null;
};


type ScreeningMovieRow = ScreeningReadRow & { movies: MovieRow | null };

type ShowtimeIndexGroupRow = {
  movie_id: string;
  cinema_id: string;
  local_date: string;
  times: string[];
  formats: string[];
  languages: string[];
  events: string[];
};

type PageResponse = {
  data: unknown[] | null;
  error: unknown;
  count?: number | null;
};

const SCREENING_COLUMNS =
  "movie_id, cinema_id, starts_at, local_date, local_time, hall, ticket_url, formats, languages, events";
const SCREENING_PAGE_SIZE = 1000;
const SCREENING_PARALLEL_PAGE_REQUESTS = 8;
const PUBLIC_DATA_CACHE_TTL_MS = 5 * 60 * 1000;

type TimedPromise<T> = { expiresAt: number; promise: Promise<T> };

const movieListCache = new Map<MovieSortStrategy, TimedPromise<Movie[]>>();
let cinemaListCache: TimedPromise<Cinema[]> | null = null;

/** A screening stops being user-visible once its advertised start time passes. */
const screeningBounds = () => ({
  firstDate: windowStart(),
  lastDate: windowEnd(),
  startsAfter: new Date().toISOString(),
});

/**
 * Supabase/PostgREST caps a response page, while canonical `screenings` has one
 * row per physical screening. Every public screening read therefore paginates
 * explicitly; otherwise a busy 30-day window would silently truncate data.
 */
async function collectPages<T>(
  loadPage: (from: number, to: number) => PromiseLike<PageResponse>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += SCREENING_PAGE_SIZE) {
    const { data, error } = await loadPage(from, from + SCREENING_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as T[];
    out.push(...page);
    if (page.length < SCREENING_PAGE_SIZE) return out;
  }
}

/**
 * High-volume listing reads first request an exact row count, then load the
 * remaining PostgREST pages in small parallel batches. Page order is retained,
 * but a national catalogue no longer pays one network round-trip per 1,000
 * screenings in series.
 */
async function collectCountedPages<T>(
  loadPage: (from: number, to: number, withCount: boolean) => PromiseLike<PageResponse>,
): Promise<T[]> {
  const first = await loadPage(0, SCREENING_PAGE_SIZE - 1, true);
  if (first.error) throw first.error;
  const firstPage = (first.data ?? []) as T[];
  if (firstPage.length < SCREENING_PAGE_SIZE) return firstPage;

  const count = first.count;
  if (count === null || count === undefined) {
    const rest = await collectPages<T>((from, to) =>
      loadPage(from + SCREENING_PAGE_SIZE, to + SCREENING_PAGE_SIZE, false),
    );
    return [...firstPage, ...rest];
  }

  const ranges: Array<[number, number]> = [];
  for (let from = SCREENING_PAGE_SIZE; from < count; from += SCREENING_PAGE_SIZE) {
    ranges.push([from, Math.min(from + SCREENING_PAGE_SIZE - 1, count - 1)]);
  }

  const out = [...firstPage];
  for (let index = 0; index < ranges.length; index += SCREENING_PARALLEL_PAGE_REQUESTS) {
    const batch = ranges.slice(index, index + SCREENING_PARALLEL_PAGE_REQUESTS);
    const responses = await Promise.all(batch.map(([from, to]) => loadPage(from, to, false)));
    for (const response of responses) {
      if (response.error) throw response.error;
      out.push(...((response.data ?? []) as T[]));
    }
  }
  return out;
}

const isMissingPublicIndexRpc = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: string; message?: string };
  return (
    value.code === "PGRST202" ||
    /get_public_showtime_index|schema cache|function.*not found/iu.test(value.message ?? "")
  );
};

export const mapShowtimeIndexGroups = (data: unknown): ShowtimeIndexRow[] => {
  const physicalRows: ScreeningIndexReadRow[] = [];
  for (const row of Array.isArray(data) ? (data as ShowtimeIndexGroupRow[]) : []) {
    for (const time of row.times ?? []) {
      physicalRows.push({
        movie_id: row.movie_id,
        cinema_id: row.cinema_id,
        local_date: row.local_date,
        local_time: time,
        formats: row.formats ?? [],
        languages: row.languages ?? [],
        events: row.events ?? [],
      });
    }
  }
  return groupScreeningIndexForUi(remapScreeningCinemaIds(physicalRows));
};

async function fetchGroupedShowtimeIndex(sourceCinemaIds: string[] | null = null) {
  const bounds = screeningBounds();
  const { data, error } = await supabase.rpc("get_public_showtime_index", {
    p_starts_after: bounds.startsAfter,
    p_first_date: bounds.firstDate,
    p_last_date: bounds.lastDate,
    // The database default is NULL (= all cinemas); the generated client types
    // express "omitted" as `undefined`, so a null scope must be sent that way.
    p_cinema_ids: sourceCinemaIds ?? undefined,

  });
  if (!error) return mapShowtimeIndexGroups(data);
  if (!isMissingPublicIndexRpc(error)) throw error;

  // Safe deployment-order fallback while the new database function reaches a
  // project. Once migrated, the normal path is one aggregated JSON response.
  const rows = await collectCountedPages<ScreeningIndexReadRow>((from, to, withCount) => {
    let query = supabase
      .from("screenings")
      .select("movie_id, cinema_id, local_date, local_time, formats, languages, events", {
        count: withCount ? "exact" : undefined,
      })
      .gte("starts_at", bounds.startsAfter)
      .gte("local_date", bounds.firstDate)
      .lte("local_date", bounds.lastDate);
    if (sourceCinemaIds) query = query.in("cinema_id", sourceCinemaIds);
    return query
      .order("starts_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
  });
  return groupScreeningIndexForUi(remapScreeningCinemaIds(rows));
}

const nonEmpty = (v: string | null | undefined): string | undefined => {
  const s = (v ?? "").trim();
  return s ? s : undefined;
};

/**
 * TMDb is preferred for film metadata; imported source metadata is the
 * fallback. The coalesce is per field, so a partial TMDb record never blanks a
 * field the source does have.
 */
const mapMovie = (r: MovieRow): Movie => {
  const sourcePoster = r.poster && typeof r.poster === "object" ? (r.poster as Poster) : {};
  const voteAverage =
    r.tmdb_vote_average === null || r.tmdb_vote_average === undefined
      ? null
      : Number(r.tmdb_vote_average);
  const rawGenres = r.tmdb_genres && r.tmdb_genres.length > 0 ? r.tmdb_genres : r.genre;
  const tmdbPoster = nonEmpty(r.tmdb_poster_url);
  const sourcePosterUrl = isPlaceholderPosterUrl(sourcePoster.url)
    ? undefined
    : nonEmpty(sourcePoster.url);
  const publicYear = resolvePublicMovieYear({
    id: r.id,
    title: r.title,
    source: r.source,
    year: r.year,
    releaseDate: r.release_date,
    tmdbId: r.tmdb_id,
  });

  return {
    id: r.id,
    slug: r.slug,
    title: publicMovieDisplayTitle(r.title),
    originalTitle: r.original_title,
    runtime: r.tmdb_runtime && r.tmdb_runtime > 0 ? r.tmdb_runtime : r.runtime,
    genre: normalizePublicGenres(rawGenres),
    year: publicYear,
    director: nonEmpty(r.tmdb_director) ?? r.director,
    rating: r.rating,
    // Listing reads deliberately omit the long text columns, so every rich
    // field must degrade to an empty value instead of `undefined`.
    synopsis: nonEmpty(r.tmdb_overview) ?? r.synopsis ?? "",

    poster: {
      ...sourcePoster,
      url: toHttpsUrl(tmdbPoster ?? sourcePosterUrl),
    },
    backdropUrl: toHttpsUrl(r.tmdb_backdrop_url) ?? null,
    trailerUrl: toHttpsUrl(r.tmdb_trailer_url) ?? null,
    cast: Array.isArray(r.tmdb_cast) ? (r.tmdb_cast as CastMember[]) : [],
    voteAverage:
      Number.isFinite(voteAverage as number) && (voteAverage as number) > 0 ? voteAverage : null,
    screeningCount: Number(r.screening_count ?? 0) || 0,
    nextScreeningDate: r.next_screening_date ?? null,
    tmdbId: r.tmdb_id ?? null,
    posterSource: tmdbPoster ? "tmdb" : sourcePosterUrl ? "source" : null,
  };
};

/**
 * Listing routes only render card metadata. Removing long descriptions, cast
 * arrays and trailer/backdrop URLs after server-side consolidation keeps the
 * homepage payload small while preserving the exact public identity chosen by
 * the richer source data. Film routes fetch the full record separately.
 */
export const compactMovieForListing = (movie: Movie): Movie => ({
  id: movie.id,
  slug: movie.slug,
  title: movie.title,
  runtime: movie.runtime,
  genre: movie.genre,
  year: movie.year,
  director: movie.director,
  rating: movie.rating,
  synopsis: "",
  poster: movie.poster,
  screeningCount: movie.screeningCount,
  sourceIds: movie.sourceIds,
  sourceSlugs: movie.sourceSlugs,
});

const compactCinemaForListing = (cinema: Cinema): Cinema => ({
  ...cinema,
  description: "",
});

const mapCinema = (r: CinemaRow): Cinema => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  city: r.city,
  address: r.address ?? "",
  description: r.description ?? "",
  screens: r.screens ?? 0,
  latitude: r.latitude,
  longitude: r.longitude,
  website: r.website ?? null,
});

/**
 * Card columns only. Listing routes throw away synopsis, cast, backdrop and
 * trailer immediately (see `compactMovieForListing`), so transferring them for
 * a national catalogue is pure payload. Typed as `string` on purpose: a literal
 * select string is parsed by supabase-js at the type level on every builder
 * reassignment, which makes the ordered query below very expensive to check.
 */
export const MOVIE_LISTING_COLUMNS: string =
  "id, slug, title, original_title, runtime, genre, year, director, rating, poster, " +
  "release_date, tmdb_id, tmdb_runtime, tmdb_genres, tmdb_poster_url, tmdb_director, " +
  "screening_count, next_screening_date";

/** Cinema card columns; the long `description` is only needed on cinema pages. */
const CINEMA_LISTING_COLUMNS: string =
  "id, slug, name, city, address, screens, latitude, longitude, website";

const mapListingMovies = (rows: unknown[]): Movie[] =>
  preparePublicMoviePosters(
    rows
      .map((row) => row as MovieRow)
      .filter((row) => isPublicMovieTitle(row.title))
      .map(mapMovie),
  );

/** Consolidate source cinema rows into the public physical cinema records. */
export const mapCinemaRows = (rows: unknown[]): Cinema[] => {
  const sourceCinemas = rows.map((r) => mapCinema(r as CinemaRow));
  const sourceById = new Map(sourceCinemas.map((cinema) => [cinema.id, cinema] as const));
  return consolidatePublicCinemas(sourceCinemas)
    .map((cinema) => {
      const members = cinema.sourceIds.map((id) => sourceById.get(id)).filter(Boolean) as Cinema[];
      return {
        ...cinema,
        description:
          cinema.description || members.find((member) => member.description)?.description || "",
        screens: Math.max(cinema.screens, ...members.map((member) => member.screens)),
        website: cinema.website || members.find((member) => member.website)?.website || null,
      };
    })
    .map(compactCinemaForListing)
    .sort((a, b) => a.name.localeCompare(b.name, "da"));
};



/** IDs allowed to influence public cards, filters and generated SEO pages. */
async function fetchPublicMovieIdSet(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("movies_ranked")
    .select("id,title,screening_count")
    .gt("screening_count", 0)
    .lte("next_screening_date", windowEnd());
  if (error) throw error;
  const ids = new Set<string>();
  for (const row of data ?? []) {
    if (row.id && isPublicMovieTitle(row.title)) ids.add(row.id);
  }
  return ids;
}

/**
 * Movies ordered by a named strategy. `movies_ranked` already counts canonical
 * physical screenings, so movie ordering is independent of legacy showtimes.
 */
export async function fetchMovies(
  strategy: MovieSortStrategy = DEFAULT_MOVIE_SORT,
): Promise<Movie[]> {
  const now = Date.now();
  const cached = movieListCache.get(strategy);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = (async () => {
    let query = supabase
      .from("movies_ranked")
      .select(MOVIE_LISTING_COLUMNS)
      .gt("screening_count", 0)
      .lte("next_screening_date", windowEnd());
    for (const o of MOVIE_SORT_ORDERS[strategy]) {
      query = query.order(o.column, { ascending: o.ascending, nullsFirst: o.nullsFirst });
    }
    const { data, error } = await query.returns<MovieRow[]>();
    if (error) throw error;
    return sortConsolidatedMovies(
      consolidatePublicMovies(mapListingMovies(data ?? [])).movies,
      strategy,
    ).map(compactMovieForListing);
  })();


  movieListCache.set(strategy, { expiresAt: now + PUBLIC_DATA_CACHE_TTL_MS, promise });
  try {
    return await promise;
  } catch (error) {
    if (movieListCache.get(strategy)?.promise === promise) movieListCache.delete(strategy);
    throw error;
  }
}

export async function fetchCinemas(): Promise<Cinema[]> {
  const now = Date.now();
  if (cinemaListCache && cinemaListCache.expiresAt > now) return cinemaListCache.promise;

  const promise = (async () => {
    const { data, error } = await supabase.from("cinemas").select("*").order("name");
    if (error) throw error;
    return mapCinemaRows(data ?? []);
  })();

  cinemaListCache = { expiresAt: now + PUBLIC_DATA_CACHE_TTL_MS, promise };
  try {
    return await promise;
  } catch (error) {
    if (cinemaListCache?.promise === promise) cinemaListCache = null;
    throw error;
  }
}

/** The warm national cinema list, when one is already in memory. */
function warmCinemaList(): Promise<Cinema[]> | null {
  return cinemaListCache && cinemaListCache.expiresAt > Date.now()
    ? cinemaListCache.promise
    : null;
}

/**
 * Only the cinemas a caller actually needs. Film pages used to download the
 * whole national cinema list just to keep the handful that show one film.
 */
export async function fetchCinemasByIds(ids: string[]): Promise<Cinema[]> {
  if (ids.length === 0) return [];
  const sourceIds = expandCinemaIds(ids);
  const wanted = new Set(sourceIds.map((id) => canonicalCinemaId(id)));

  const warm = warmCinemaList();
  if (warm) return (await warm).filter((cinema) => wanted.has(cinema.id));

  const { data, error } = await supabase
    .from("cinemas")
    .select(CINEMA_LISTING_COLUMNS)
    .in("id", sourceIds)
    .order("name")
    .returns<CinemaRow[]>();
  if (error) throw error;
  return mapCinemaRows(data ?? []);
}

/**
 * Bounded first-paint reads.
 *
 * The homepage renders a small slice of movie and cinema cards, so its SSR
 * loader must not await (nor serialize) the national catalogue. Source rows
 * are over-sampled because consolidation merges duplicate source records
 * before the visible slice is taken.
 */
const SHELL_OVERSAMPLE = 3;

/** A missing/not-yet-cached RPC, i.e. code deployed before its migration. */
const isMissingFunctionError = (error: { code?: string; message?: string } | null): boolean => {
  if (!error) return false;
  const code = error.code ?? "";
  if (code === "PGRST202" || code === "42883") return true;
  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("could not find the function") ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  );
};

type HomeShellRow = MovieRow & { total_count?: number | string | null };

/**
 * Top movies for the bounded shell. The RPC resolves ranking, the public
 * cinema rule and the total in a single narrow query; the `movies_ranked`
 * path stays as a fallback for the window where code is deployed before the
 * migration has propagated.
 */
export async function fetchTopMovies(
  limit: number,
  strategy: MovieSortStrategy = DEFAULT_MOVIE_SORT,
): Promise<{ movies: Movie[]; total: number }> {
  const consolidate = (rows: unknown[], total: number | null) => {
    const movies = sortConsolidatedMovies(
      consolidatePublicMovies(mapListingMovies(rows)).movies,
      strategy,
    )
      .map(compactMovieForListing)
      .slice(0, limit);
    return { movies, total: total ?? movies.length };
  };

  if (strategy === DEFAULT_MOVIE_SORT) {
    const { data, error } = await supabase
      .rpc("get_home_shell_movies", { p_limit: limit })
      .returns<HomeShellRow[]>();
    if (!error) {
      const rows = data ?? [];
      const total = Number(rows[0]?.total_count ?? 0);
      return consolidate(rows, Number.isFinite(total) && total > 0 ? total : null);
    }
    if (!isMissingFunctionError(error)) throw error;
  }

  let query = supabase
    .from("movies_ranked")
    .select(MOVIE_LISTING_COLUMNS, { count: "exact" })
    .gt("screening_count", 0)
    .lte("next_screening_date", windowEnd());
  for (const o of MOVIE_SORT_ORDERS[strategy]) {
    query = query.order(o.column, { ascending: o.ascending, nullsFirst: o.nullsFirst });
  }
  const { data, error, count } = await query
    .range(0, limit * SHELL_OVERSAMPLE - 1)
    .returns<MovieRow[]>();
  if (error) throw error;
  return consolidate(data ?? [], count ?? null);
}


export async function fetchTopCinemas(limit: number): Promise<{
  cinemas: Cinema[];
  total: number;
}> {
  const { data, error, count } = await supabase
    .from("cinemas")
    .select(CINEMA_LISTING_COLUMNS, { count: "exact" })
    .order("name")
    .range(0, limit * SHELL_OVERSAMPLE - 1)
    .returns<CinemaRow[]>();
  if (error) throw error;
  const cinemas = mapCinemaRows(data ?? []).slice(0, limit);
  return { cinemas, total: count ?? cinemas.length };
}


export async function fetchMovieBySlug(slug: string): Promise<Movie | null> {
  // A detail page needs rich metadata from the requested row and the compact
  // catalogue's canonical identity. The latter preserves every source id, so
  // a consolidated film never loses screenings from one of its providers.
  const [rankedResult, activeMovies] = await Promise.all([
    supabase
      .from("movies_ranked")
      .select("*")
      .eq("slug", slug)
      .gt("screening_count", 0)
      .lte("next_screening_date", windowEnd())
      .maybeSingle(),
    fetchMovies(),
  ]);
  const { data: ranked, error: rankedError } = rankedResult;
  if (rankedError) throw rankedError;

  const active = activeMovies.find(
    (movie) =>
      (movie.sourceSlugs ?? [movie.slug]).includes(slug) ||
      (ranked?.id ? (movie.sourceIds ?? [movie.id]).includes(ranked.id) : false),
  );
  if (active) {
    const sourceIds = active.sourceIds ?? [active.id];
    if (ranked && sourceIds.length === 1 && sourceIds[0] === ranked.id) {
      return {
        ...(preparePublicMoviePosters([mapMovie(ranked as MovieRow)])[0] ?? active),
        sourceIds: active.sourceIds,
        sourceSlugs: active.sourceSlugs,
      };
    }
    const { data, error } = await supabase.from("movies_ranked").select("*").in("id", sourceIds);
    if (error) throw error;
    const rows = preparePublicMoviePosters(
      (data ?? [])
        .map((row) => row as MovieRow)
        .filter((row) => isPublicMovieTitle(row.title))
        .map(mapMovie),
    );
    const detailed = consolidatePublicMovies(rows).movies.find((movie) =>
      (movie.sourceSlugs ?? [movie.slug]).includes(slug),
    );
    return detailed ?? active;
  }

  if (ranked && isPublicMovieTitle(ranked.title)) {
    return preparePublicMoviePosters([mapMovie(ranked as MovieRow)])[0] ?? null;
  }

  const { data, error } = await supabase.from("movies").select("*").eq("slug", slug).maybeSingle();
  if (error) throw error;
  if (!data || !isPublicMovieTitle(data.title)) return null;
  return preparePublicMoviePosters([mapMovie(data as MovieRow)])[0] ?? null;
}

export async function fetchCinemaBySlug(slug: string): Promise<Cinema | null> {
  const cinemas = await fetchCinemas();
  return cinemas.find((cinema) => (cinema.sourceSlugs ?? [cinema.slug]).includes(slug)) ?? null;
}

type MovieShowtimeGroupRow = {
  movie_id: string;
  cinema_id: string;
  local_date: string;
  hall: string;
  times: string[];
  ticket_urls?: string[];
  formats: string[];
  languages: string[];
  events: string[];
};

function mapMovieShowtimeGroups(
  data: unknown,
  movieIds: string[],
  includeTicketUrls: boolean,
): Showtime[] {
  const grouped = sortShowtimes(
    (Array.isArray(data) ? (data as MovieShowtimeGroupRow[]) : []).map((row) => {
      const ticketUrls = includeTicketUrls
        ? (row.ticket_urls ?? []).map((url) => normalizeTicketUrl(url) ?? "")
        : [];
      return {
        movieId: row.movie_id,
        cinemaId: canonicalCinemaId(row.cinema_id),
        date: row.local_date,
        times: row.times ?? [],
        hall: row.hall,
        bookingUrl: ticketUrls.find(Boolean) ?? null,
        ticketUrls,
        formats: row.formats ?? [],
        languages: row.languages ?? [],
        events: row.events ?? [],
      };
    }),
  );
  if (movieIds.length === 1) return grouped;
  const canonicalMovie: Movie = {
    id: movieIds[0]!,
    slug: "",
    title: "",
    runtime: 0,
    genre: [],
    year: 0,
    director: "",
    rating: "",
    synopsis: "",
    poster: {},
    sourceIds: movieIds,
  };
  return remapShowtimesToMovies(grouped, [canonicalMovie]);
}

async function fetchGroupedMovieShowtimes(
  movieId: string | string[],
  withTicketUrls: boolean,
): Promise<Showtime[]> {
  const bounds = screeningBounds();
  const movieIds = Array.isArray(movieId) ? [...new Set(movieId)] : [movieId];
  const args = {
    p_movie_ids: movieIds,
    p_starts_after: bounds.startsAfter,
    p_first_date: bounds.firstDate,
    p_last_date: bounds.lastDate,
  };
  const { data, error } = withTicketUrls
    ? await supabase.rpc("get_movie_showtime_groups", args)
    : await supabase.rpc("get_movie_showtime_schedule", args);
  if (error) throw error;
  return mapMovieShowtimeGroups(data, movieIds, withTicketUrls);
}

/** Fast programme payload used while navigating to a film page. */
export async function fetchShowtimesForMovie(movieId: string | string[]): Promise<Showtime[]> {
  return fetchGroupedMovieShowtimes(movieId, false);
}

/** Ticket URLs are large, so the film page fetches them after its programme is visible. */
export async function fetchTicketedShowtimesForMovie(
  movieId: string | string[],
): Promise<Showtime[]> {
  return fetchGroupedMovieShowtimes(movieId, true);
}

export async function fetchMoviesForCinema(cinemaId: string): Promise<Movie[]> {
  const bounds = screeningBounds();
  const cinemaIds = expandCinemaIds([cinemaId]);
  const rows = await collectPages<{ movie_id: string; movies: MovieRow | null }>((from, to) =>
    supabase
      .from("screenings")
      .select("movie_id, movies(*)")
      .in("cinema_id", cinemaIds)
      .gte("starts_at", bounds.startsAfter)
      .gte("local_date", bounds.firstDate)
      .lte("local_date", bounds.lastDate)
      .order("starts_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  const seen = new Set<string>();
  const out: Movie[] = [];
  for (const row of rows) {
    if (!row.movies || seen.has(row.movie_id)) continue;
    if (!isPublicMovieTitle(row.movies.title)) continue;
    const movie = mapMovie(row.movies);
    seen.add(row.movie_id);
    out.push(movie);
  }
  const visible = preparePublicMoviePosters(out);
  return consolidatePublicMovies(visible)
    .movies.map(compactMovieForListing)
    .sort((a, b) => a.title.localeCompare(b.title, "da"));
}

export async function fetchCinemasForMovie(movieId: string | string[]): Promise<Cinema[]> {
  const bounds = screeningBounds();
  const movieIds = Array.isArray(movieId) ? [...new Set(movieId)] : [movieId];
  const rows = await collectPages<{ cinema_id: string; cinemas: CinemaRow | null }>((from, to) => {
    let query = supabase
      .from("screenings")
      .select("cinema_id, cinemas(*)")
      .gte("starts_at", bounds.startsAfter)
      .gte("local_date", bounds.firstDate)
      .lte("local_date", bounds.lastDate);
    query =
      movieIds.length === 1 ? query.eq("movie_id", movieIds[0]!) : query.in("movie_id", movieIds);
    return query
      .order("starts_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
  });
  const cinemaIds = new Set(rows.map((row) => canonicalCinemaId(row.cinema_id)));
  return fetchCinemasByIds([...cinemaIds]);
}

/**
 * Film pages need the same showtime rows to identify their cinemas. The
 * programme is loaded first so only the cinemas that actually show the film are
 * requested — the national cinema list is never part of a film navigation.
 */
export async function fetchMovieProgramme(
  movieId: string | string[],
): Promise<{ cinemas: Cinema[]; showtimes: Showtime[] }> {
  const showtimes = await fetchShowtimesForMovie(movieId);
  const cinemaIds = new Set(showtimes.map((showtime) => showtime.cinemaId));
  const cinemas = await fetchCinemasByIds([...cinemaIds]);
  return {
    cinemas: cinemas.filter((cinema) => cinemaIds.has(cinema.id)),
    showtimes,
  };
}


export function formatRuntime(min: number) {
  if (!Number.isFinite(min) || min <= 0) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}t` : `${h}t ${m}m`;
}

export async function fetchMovieCinemaPairs(): Promise<
  Array<{ movieId: string; cinemaId: string }>
> {
  const bounds = screeningBounds();
  const [rows, publicMovieIds] = await Promise.all([
    collectPages<{ movie_id: string; cinema_id: string }>((from, to) =>
      supabase
        .from("screenings")
        .select("movie_id, cinema_id")
        .gte("starts_at", bounds.startsAfter)
        .gte("local_date", bounds.firstDate)
        .lte("local_date", bounds.lastDate)
        .order("starts_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchPublicMovieIdSet(),
  ]);
  const seen = new Set<string>();
  const out: Array<{ movieId: string; cinemaId: string }> = [];
  for (const row of rows) {
    if (!publicMovieIds.has(row.movie_id)) continue;
    const cinemaId = canonicalCinemaId(row.cinema_id);
    const key = `${row.movie_id}|${cinemaId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ movieId: row.movie_id, cinemaId });
  }
  return out;
}

export async function fetchShowtimes(): Promise<Showtime[]> {
  const bounds = screeningBounds();
  const [rows, publicMovieIds] = await Promise.all([
    collectPages<ScreeningReadRow>((from, to) =>
      supabase
        .from("screenings")
        .select(SCREENING_COLUMNS)
        .gte("starts_at", bounds.startsAfter)
        .gte("local_date", bounds.firstDate)
        .lte("local_date", bounds.lastDate)
        .order("starts_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchPublicMovieIdSet(),
  ]);
  return groupScreeningsForUi(
    remapScreeningCinemaIds(rows.filter((row) => publicMovieIds.has(row.movie_id))),
  );
}

/** Lightweight index used by homepage radius/date/tag filtering. */
export async function fetchShowtimeIndex(): Promise<ShowtimeIndexRow[]> {
  const [rows, publicMovieIds] = await Promise.all([
    fetchGroupedShowtimeIndex(),
    fetchPublicMovieIdSet(),
  ]);
  return rows.filter((row) => publicMovieIds.has(row.movieId));
}

/**
 * City listings only need card metadata and the filter index. Fetching
 * `movies(*)` once per physical screening multiplied the response size for
 * large cities, so this path reuses the compact national movie catalogue and
 * loads only the seven screening fields used by filters.
 */
export async function fetchMoviesAndShowtimeIndexForCinemas(
  cinemaIds: string[],
): Promise<{ movies: Movie[]; showtimes: ShowtimeIndexRow[] }> {
  if (cinemaIds.length === 0) return { movies: [], showtimes: [] };
  const sourceCinemaIds = expandCinemaIds(cinemaIds);
  const [rows, allMovies] = await Promise.all([
    fetchGroupedShowtimeIndex(sourceCinemaIds),
    fetchMovies(),
  ]);
  const sourceMovieIds = new Set(rows.map((row) => row.movieId));
  const movies = allMovies.filter((movie) =>
    (movie.sourceIds ?? [movie.id]).some((id) => sourceMovieIds.has(id)),
  );
  const showtimes = remapShowtimeIndexToMovies(rows, movies);
  return { movies, showtimes };
}

export async function fetchShowtimesForCinema(cinemaId: string): Promise<Showtime[]> {
  const bounds = screeningBounds();
  const cinemaIds = expandCinemaIds([cinemaId]);
  const [rows, publicMovieIds] = await Promise.all([
    collectPages<ScreeningReadRow>((from, to) =>
      supabase
        .from("screenings")
        .select(SCREENING_COLUMNS)
        .in("cinema_id", cinemaIds)
        .gte("starts_at", bounds.startsAfter)
        .gte("local_date", bounds.firstDate)
        .lte("local_date", bounds.lastDate)
        .order("starts_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchPublicMovieIdSet(),
  ]);
  return groupScreeningsForUi(
    remapScreeningCinemaIds(rows.filter((row) => publicMovieIds.has(row.movie_id))),
  );
}

export async function fetchMoviesAndShowtimesForCinemas(
  cinemaIds: string[],
): Promise<{ movies: Movie[]; showtimes: Showtime[] }> {
  if (cinemaIds.length === 0) return { movies: [], showtimes: [] };
  const bounds = screeningBounds();
  const sourceCinemaIds = expandCinemaIds(cinemaIds);
  const rows = await collectPages<ScreeningMovieRow>((from, to) =>
    supabase
      .from("screenings")
      .select(`${SCREENING_COLUMNS}, movies(*)`)
      .in("cinema_id", sourceCinemaIds)
      .gte("starts_at", bounds.startsAfter)
      .gte("local_date", bounds.firstDate)
      .lte("local_date", bounds.lastDate)
      .order("starts_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );

  const visibleRows = rows.filter((row) => row.movies && isPublicMovieTitle(row.movies.title));
  const seen = new Set<string>();
  const movies: Movie[] = [];
  for (const row of visibleRows) {
    if (row.movies && !seen.has(row.movie_id)) {
      seen.add(row.movie_id);
      movies.push(mapMovie(row.movies));
    }
  }
  const visibleMovies = preparePublicMoviePosters(movies);
  const consolidated = consolidatePublicMovies(visibleMovies).movies;
  return {
    movies: consolidated.map(compactMovieForListing),
    showtimes: remapShowtimesToMovies(
      groupScreeningsForUi(remapScreeningCinemaIds(visibleRows)),
      consolidated,
    ),
  };
}
