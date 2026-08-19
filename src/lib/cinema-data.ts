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
  type ScreeningIndexReadRow,
  type ScreeningReadRow,
  type UiShowtime,
  type UiShowtimeIndexRow,
} from "@/lib/screening-read-model";
import { consolidatePublicMovies, remapShowtimesToMovies } from "@/lib/public-catalog";
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
  address: string;
  description: string;
  screens: number;
  latitude: number | null;
  longitude: number | null;
  website: string | null;
};

type ScreeningMovieRow = ScreeningReadRow & { movies: MovieRow | null };

type PageResponse = {
  data: unknown[] | null;
  error: unknown;
};

const SCREENING_COLUMNS =
  "movie_id, cinema_id, starts_at, local_date, local_time, hall, ticket_url, formats, languages, events";
const SCREENING_PAGE_SIZE = 1000;

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
    synopsis: nonEmpty(r.tmdb_overview) ?? r.synopsis,
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

const mapCinema = (r: CinemaRow): Cinema => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  city: r.city,
  address: r.address,
  description: r.description,
  screens: r.screens,
  latitude: r.latitude,
  longitude: r.longitude,
  website: r.website ?? null,
});

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
  let query = supabase
    .from("movies_ranked")
    .select("*")
    .gt("screening_count", 0)
    .lte("next_screening_date", windowEnd());
  for (const o of MOVIE_SORT_ORDERS[strategy]) {
    query = query.order(o.column, { ascending: o.ascending, nullsFirst: o.nullsFirst });
  }
  const { data, error } = await query;
  if (error) throw error;
  const visible = preparePublicMoviePosters(
    (data ?? [])
      .map((row) => row as MovieRow)
      .filter((row) => isPublicMovieTitle(row.title))
      .map(mapMovie),
  );
  return sortConsolidatedMovies(consolidatePublicMovies(visible).movies, strategy);
}

export async function fetchCinemas(): Promise<Cinema[]> {
  const { data, error } = await supabase.from("cinemas").select("*").order("name");
  if (error) throw error;
  const sourceCinemas = (data ?? []).map((r) => mapCinema(r as CinemaRow));
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
    .sort((a, b) => a.name.localeCompare(b.name, "da"));
}

export async function fetchMovieBySlug(slug: string): Promise<Movie | null> {
  const activeMovies = await fetchMovies();
  const active = activeMovies.find((movie) => (movie.sourceSlugs ?? [movie.slug]).includes(slug));
  if (active) return active;

  const { data, error } = await supabase.from("movies").select("*").eq("slug", slug).maybeSingle();
  if (error) throw error;
  if (!data || !isPublicMovieTitle(data.title)) return null;
  return preparePublicMoviePosters([mapMovie(data as MovieRow)])[0] ?? null;
}

export async function fetchCinemaBySlug(slug: string): Promise<Cinema | null> {
  const cinemas = await fetchCinemas();
  return cinemas.find((cinema) => (cinema.sourceSlugs ?? [cinema.slug]).includes(slug)) ?? null;
}

export async function fetchShowtimesForMovie(movieId: string | string[]): Promise<Showtime[]> {
  const bounds = screeningBounds();
  const movieIds = Array.isArray(movieId) ? [...new Set(movieId)] : [movieId];
  const loadPage = async (from: number, to: number, includeCount = false) => {
    let query = includeCount
      ? supabase.from("screenings").select(SCREENING_COLUMNS, { count: "exact" })
      : supabase.from("screenings").select(SCREENING_COLUMNS);
    query = query
      .gte("starts_at", bounds.startsAfter)
      .gte("local_date", bounds.firstDate)
      .lte("local_date", bounds.lastDate);
    query =
      movieIds.length === 1 ? query.eq("movie_id", movieIds[0]!) : query.in("movie_id", movieIds);
    return query
      .order("starts_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
  };

  // Supabase returns at most 1,000 rows per response. Popular films can exceed
  // two pages, so fetch the first page with an exact count and request every
  // remaining page concurrently instead of making mobile visitors wait for
  // three or more consecutive network round trips.
  const first = await loadPage(0, SCREENING_PAGE_SIZE - 1, true);
  if (first.error) throw first.error;
  const total = first.count ?? first.data?.length ?? 0;
  const remainingStarts = Array.from(
    { length: Math.max(0, Math.ceil(total / SCREENING_PAGE_SIZE) - 1) },
    (_, index) => (index + 1) * SCREENING_PAGE_SIZE,
  );
  const remaining = await Promise.all(
    remainingStarts.map((from) => loadPage(from, from + SCREENING_PAGE_SIZE - 1)),
  );
  for (const page of remaining) {
    if (page.error) throw page.error;
  }
  const rows = [
    ...((first.data ?? []) as ScreeningReadRow[]),
    ...remaining.flatMap((page) => (page.data ?? []) as ScreeningReadRow[]),
  ];
  const grouped = groupScreeningsForUi(remapScreeningCinemaIds(rows));
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
  return consolidatePublicMovies(visible).movies.sort((a, b) =>
    a.title.localeCompare(b.title, "da"),
  );
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
  const cinemas = await fetchCinemas();
  return cinemas.filter((cinema) => cinemaIds.has(cinema.id));
}

/**
 * Film pages need the same showtime rows to identify their cinemas. Loading the
 * compact programme once avoids returning the full cinema record once per
 * screening, which was especially expensive for popular films on mobile.
 */
export async function fetchMovieProgramme(
  movieId: string | string[],
): Promise<{ cinemas: Cinema[]; showtimes: Showtime[] }> {
  const [showtimes, cinemas] = await Promise.all([fetchShowtimesForMovie(movieId), fetchCinemas()]);
  const cinemaIds = new Set(showtimes.map((showtime) => showtime.cinemaId));
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
  const bounds = screeningBounds();
  const [rows, publicMovieIds] = await Promise.all([
    collectPages<ScreeningIndexReadRow>((from, to) =>
      supabase
        .from("screenings")
        .select("movie_id, cinema_id, local_date, local_time, formats, languages, events")
        .gte("starts_at", bounds.startsAfter)
        .gte("local_date", bounds.firstDate)
        .lte("local_date", bounds.lastDate)
        .order("starts_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchPublicMovieIdSet(),
  ]);
  return groupScreeningIndexForUi(
    remapScreeningCinemaIds(rows.filter((row) => publicMovieIds.has(row.movie_id))),
  );
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
    movies: consolidated,
    showtimes: remapShowtimesToMovies(
      groupScreeningsForUi(remapScreeningCinemaIds(visibleRows)),
      consolidated,
    ),
  };
}
