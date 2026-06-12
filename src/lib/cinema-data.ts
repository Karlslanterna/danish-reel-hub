import { supabase } from "@/integrations/supabase/client";

export type Poster = { a: string; b: string; c: string; d: string };

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
};

export type Cinema = {
  id: string;
  slug: string;
  name: string;
  city: string;
  address: string;
  description: string;
  screens: number;
};

export type Showtime = {
  movieId: string;
  cinemaId: string;
  date: string;
  times: string[];
  hall: string;
  bookingUrl: string | null;
};

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
};

type CinemaRow = {
  id: string;
  slug: string;
  name: string;
  city: string;
  address: string;
  description: string;
  screens: number;
};

type ShowtimeRow = {
  movie_id: string;
  cinema_id: string;
  date: string;
  times: string[];
  hall: string;
  booking_url: string | null;
};

const mapMovie = (r: MovieRow): Movie => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  originalTitle: r.original_title,
  runtime: r.runtime,
  genre: r.genre,
  year: r.year,
  director: r.director,
  rating: r.rating,
  synopsis: r.synopsis,
  poster: r.poster as Poster,
});

const mapCinema = (r: CinemaRow): Cinema => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  city: r.city,
  address: r.address,
  description: r.description,
  screens: r.screens,
});

const mapShowtime = (r: ShowtimeRow): Showtime => ({
  movieId: r.movie_id,
  cinemaId: r.cinema_id,
  date: r.date,
  times: r.times,
  hall: r.hall,
  bookingUrl: r.booking_url,
});

export async function fetchMovies(): Promise<Movie[]> {
  const { data, error } = await supabase.from("movies").select("*").order("title");
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
  const { data, error } = await supabase
    .from("showtimes")
    .select("*")
    .eq("movie_id", movieId);
  if (error) throw error;
  return (data ?? []).map(mapShowtime);
}

export async function fetchMoviesForCinema(cinemaId: string): Promise<Movie[]> {
  const { data, error } = await supabase
    .from("showtimes")
    .select("movie_id, movies(*)")
    .eq("cinema_id", cinemaId);
  if (error) throw error;
  const seen = new Set<string>();
  const out: Movie[] = [];
  for (const row of (data ?? []) as Array<{ movie_id: string; movies: MovieRow | null }>) {
    if (!row.movies || seen.has(row.movie_id)) continue;
    seen.add(row.movie_id);
    out.push(mapMovie(row.movies));
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, "da"));
}

export async function fetchCinemasForMovie(movieId: string): Promise<Cinema[]> {
  const { data, error } = await supabase
    .from("showtimes")
    .select("cinema_id, cinemas(*)")
    .eq("movie_id", movieId);
  if (error) throw error;
  const seen = new Set<string>();
  const out: Cinema[] = [];
  for (const row of (data ?? []) as Array<{ cinema_id: string; cinemas: CinemaRow | null }>) {
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
