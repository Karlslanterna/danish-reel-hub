/**
 * Read helpers for the canonical `screenings` table.
 *
 * The frontend currently reads the legacy grouped `showtimes` model, which is
 * rebuilt from `screenings` after every promotion. These helpers give the UI
 * a drop-in path onto the canonical model: one row per physical screening,
 * grouped on demand instead of in the database.
 */
import { supabase } from "@/integrations/supabase/client";

export type Screening = {
  id: string;
  source: string;
  cinemaId: string;
  movieId: string;
  startsAt: string;
  date: string;
  time: string;
  hall: string;
  ticketUrl: string | null;
  priceMin: number | null;
  priceMax: number | null;
  freeSeats: number | null;
  formats: string[];
  languages: string[];
  events: string[];
};

const SELECT =
  "id, source, cinema_id, movie_id, starts_at, local_date, local_time, hall, ticket_url, price_min, price_max, free_seats, formats, languages, events";

type Row = {
  id: string;
  source: string;
  cinema_id: string;
  movie_id: string;
  starts_at: string;
  local_date: string;
  local_time: string;
  hall: string;
  ticket_url: string | null;
  price_min: number | null;
  price_max: number | null;
  free_seats: number | null;
  formats: string[] | null;
  languages: string[] | null;
  events: string[] | null;
};

export function toScreening(row: Row): Screening {
  return {
    id: row.id,
    source: row.source,
    cinemaId: row.cinema_id,
    movieId: row.movie_id,
    startsAt: row.starts_at,
    date: row.local_date,
    time: row.local_time.slice(0, 5),
    hall: row.hall,
    ticketUrl: row.ticket_url,
    priceMin: row.price_min,
    priceMax: row.price_max,
    freeSeats: row.free_seats,
    formats: row.formats ?? [],
    languages: row.languages ?? [],
    events: row.events ?? [],
  };
}

export type ScreeningQuery = {
  movieId?: string;
  cinemaId?: string;
  cinemaIds?: string[];
  /** Inclusive local date bounds (YYYY-MM-DD). */
  from?: string;
  to?: string;
  limit?: number;
};

export async function fetchScreenings(query: ScreeningQuery): Promise<Screening[]> {
  let q = supabase.from("screenings").select(SELECT).order("starts_at", { ascending: true });
  if (query.movieId) q = q.eq("movie_id", query.movieId);
  if (query.cinemaId) q = q.eq("cinema_id", query.cinemaId);
  if (query.cinemaIds?.length) q = q.in("cinema_id", query.cinemaIds);
  if (query.from) q = q.gte("local_date", query.from);
  if (query.to) q = q.lte("local_date", query.to);
  if (query.limit) q = q.limit(query.limit);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map(toScreening);
}

/** Group screenings the way the UI renders them: date -> cinema -> times. */
export function groupByDateAndCinema(
  screenings: Screening[],
): Array<{ date: string; cinemas: Array<{ cinemaId: string; screenings: Screening[] }> }> {
  const byDate = new Map<string, Map<string, Screening[]>>();
  for (const s of [...screenings].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const cinemas = byDate.get(s.date) ?? new Map<string, Screening[]>();
    cinemas.set(s.cinemaId, [...(cinemas.get(s.cinemaId) ?? []), s]);
    byDate.set(s.date, cinemas);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, cinemas]) => ({
      date,
      cinemas: [...cinemas.entries()].map(([cinemaId, list]) => ({ cinemaId, screenings: list })),
    }));
}
