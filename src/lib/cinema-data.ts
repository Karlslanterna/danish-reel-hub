import { supabase } from "@/integrations/supabase/client";
import { toHttpsUrl } from "@/lib/poster-url";
import { DEFAULT_MOVIE_SORT, MOVIE_SORT_ORDERS, type MovieSortStrategy } from "@/lib/movie-sort";
import { windowStart, windowEnd } from "@/lib/date-window";
import {
  groupScreeningIndexForUi,
  groupScreeningsForUi,
  type ScreeningIndexReadRow,
  type ScreeningReadRow,
  type UiShowtime,
  type UiShowtimeIndexRow,
} from "@/lib/screening-read-model";

export type Poster = {
  a?: string;
  b?: string;
  c?: string;
  d?: string;
  url?: string;
  alt?: string;
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
  screening_count?: number | string | null;
  next_screening_date?: string | null;
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
  const sourcePoster = r.poster as Poster;
  const voteAverage =
    r.tmdb_vote_average === null || r.tmdb_vote_average === undefined
      ? null
      : Number(r.tmdb_vote_average);

  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    originalTitle: r.original_title,
    runtime: r.tmdb_runtime && r.tmdb_runtime > 0 ? r.tmdb_runtime : r.runtime,
    genre: r.tmdb_genres && r.tmdb_genres.length > 0 ? r.tmdb_genres : r.genre,
    year: r.year,
    director: nonEmpty(r.tmdb_director) ?? r.director,
    rating: r.rating,
    synopsis: nonEmpty(r.tmdb_overview) ?? r.synopsis,
    poster: {
      ...sourcePoster,
      url: toHttpsUrl(nonEmpty(r.tmdb_poster_url) ?? sourcePoster?.url),
    },
    backdropUrl: toHttpsUrl(r.tmdb_backdrop_url) ?? null,
    trailerUrl: toHttpsUrl(r.tmdb_trailer_url) ?? null,
    cast: Array.isArray(r.tmdb_cast) ? (r.tmdb_cast as CastMember[]) : [],
    voteAverage:
      Number.isFinite(voteAverage as number) && (voteAverage as number) > 0 ? voteAverage : null,
    screeningCount: Number(r.screening_count ?? 0) || 0,
    nextScreeningDate: r.next_screening_date ?? null,
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

/**
 * Movies ordered by a named strategy. `movies_ranked` already counts canonical
 * physical screenings, so movie ordering is independent of legacy showtimes.
 */
export async function fetchMovies(
  strategy: MovieSortStrategy = DEFAULT_MOVIE_SORT,
): Promise<Movie[]> {
  let query = supabase.from("movies_ranked").select("*");
  for (const o of MOVIE_SORT_ORDERS[strategy]) {
    query = query.order(o.column, { ascending: o.ascending, nullsFirst: o.nullsFirst });
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((r) => mapMovie(r as MovieRow));
}

export async function fetchCinemas(): Promise<Cinema[]> {
  const { data, error } = await supabase.from("cinemas").select("*").order("name");
  if (error) throw error;
  return (data ?? []).map((r) => mapCinema(r as CinemaRow));
}

export async function fetchMovieBySlug(slug: string): Promise<Movie | null> {
  const { data, error } = await supabase.from("movies").select("*").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data ? mapMovie(data as MovieRow) : null;
}

export async function fetchCinemaBySlug(slug: string): Promise<Cinema | null> {
  const { data, error } = await supabase.from("cinemas").select("*").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return data ? mapCinema(data as CinemaRow) : null;
}

export async function fetchShowtimesForMovie(movieId: string): Promise<Showtime[]> {
  const bounds = screeningBounds();
  const rows = await collectPages<ScreeningReadRow>((from, to) =>
    supabase
      .from("screenings")
      .select(SCREENING_COLUMNS)
      .eq("movie_id", movieId)
      .gte("starts_at", bounds.startsAfter)
      .gte("local_date", bounds.firstDate)
      .lte("local_date", bounds.lastDate)
      .order("starts_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  return groupScreeningsForUi(rows);
}

export async function fetchMoviesForCinema(cinemaId: string): Promise<Movie[]> {
  const bounds = screeningBounds();
  const rows = await collectPages<{ movie_id: string; movies: MovieRow | null }>((from, to) =>
    supabase
      .from("screenings")
      .select("movie_id, movies(*)")
      .eq("cinema_id", cinemaId)
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
    seen.add(row.movie_id);
    out.push(mapMovie(row.movies));
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, "da"));
}

export async function fetchCinemasForMovie(movieId: string): Promise<Cinema[]> {
  const bounds = screeningBounds();
  const rows = await collectPages<{ cinema_id: string; cinemas: CinemaRow | null }>((from, to) =>
    supabase
      .from("screenings")
      .select("cinema_id, cinemas(*)")
      .eq("movie_id", movieId)
      .gte("starts_at", bounds.startsAfter)
      .gte("local_date", bounds.firstDate)
      .lte("local_date", bounds.lastDate)
      .order("starts_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  const seen = new Set<string>();
  const out: Cinema[] = [];
  for (const row of rows) {
    if (!row.cinemas || seen.has(row.cinema_id)) continue;
    seen.add(row.cinema_id);
    out.push(mapCinema(row.cinemas));
  }
  return out;
}

export function formatRuntime(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}t ${m}m`;
}

export async function fetchMovieCinemaPairs(): Promise<Array<{ movieId: string; cinemaId: string }>> {
  const bounds = screeningBounds();
  const rows = await collectPages<{ movie_id: string; cinema_id: string }>((from, to) =>
    supabase
      .from("screenings")
      .select("movie_id, cinema_id")
      .gte("starts_at", bounds.startsAfter)
      .gte("local_date", bounds.firstDate)
      .lte("local_date", bounds.lastDate)
      .order("starts_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  const seen = new Set<string>();
  const out: Array<{ movieId: string; cinemaId: string }> = [];
  for (const row of rows) {
    const key = `${row.movie_id}|${row.cinema_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ movieId: row.movie_id, cinemaId: row.cinema_id });
  }
  return out;
}

export async function fetchShowtimes(): Promise<Showtime[]> {
  const bounds = screeningBounds();
  const rows = await collectPages<ScreeningReadRow>((from, to) =>
    supabase
      .from("screenings")
      .select(SCREENING_COLUMNS)
      .gte("starts_at", bounds.startsAfter)
      .gte("local_date", bounds.firstDate)
      .lte("local_date", bounds.lastDate)
      .order("starts_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  return groupScreeningsForUi(rows);
}

/** Lightweight index used by homepage radius/date/tag filtering. */
export async function fetchShowtimeIndex(): Promise<ShowtimeIndexRow[]> {
  const bounds = screeningBounds();
  const rows = await collectPages<ScreeningIndexReadRow>((from, to) =>
    supabase
      .from("screenings")
      .select("movie_id, cinema_id, local_date, formats, languages, events")
      .gte("starts_at", bounds.startsAfter)
      .gte("local_date", bounds.firstDate)
      .lte("local_date", bounds.lastDate)
      .order("starts_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  return groupScreeningIndexForUi(rows);
}

export async function fetchShowtimesForCinema(cinemaId: string): Promise<Showtime[]> {
  const bounds = screeningBounds();
  const rows = await collectPages<ScreeningReadRow>((from, to) =>
    supabase
      .from("screenings")
      .select(SCREENING_COLUMNS)
      .eq("cinema_id", cinemaId)
      .gte("starts_at", bounds.startsAfter)
      .gte("local_date", bounds.firstDate)
      .lte("local_date", bounds.lastDate)
      .order("starts_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  return groupScreeningsForUi(rows);
}

export async function fetchMoviesAndShowtimesForCinemas(
  cinemaIds: string[],
): Promise<{ movies: Movie[]; showtimes: Showtime[] }> {
  if (cinemaIds.length === 0) return { movies: [], showtimes: [] };
  const bounds = screeningBounds();
  const rows = await collectPages<ScreeningMovieRow>((from, to) =>
    supabase
      .from("screenings")
      .select(`${SCREENING_COLUMNS}, movies(*)`)
      .in("cinema_id", cinemaIds)
      .gte("starts_at", bounds.startsAfter)
      .gte("local_date", bounds.firstDate)
      .lte("local_date", bounds.lastDate)
      .order("starts_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );

  const seen = new Set<string>();
  const movies: Movie[] = [];
  for (const row of rows) {
    if (row.movies && !seen.has(row.movie_id)) {
      seen.add(row.movie_id);
      movies.push(mapMovie(row.movies));
    }
  }
  return { movies, showtimes: groupScreeningsForUi(rows) };
}
