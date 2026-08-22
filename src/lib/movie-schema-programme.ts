import { supabase } from "@/integrations/supabase/client";
import { canonicalCinemaId } from "@/lib/cinema-catalog";
import { fetchCinemasByIds, type Cinema, type Showtime } from "@/lib/cinema-data";
import { windowEnd, windowStart } from "@/lib/date-window";
import { normalizeTicketUrl } from "@/lib/screening-read-model";

const DEFAULT_SCHEMA_EVENT_LIMIT = 3;
const RAW_OVERSAMPLE = 16;

type SchemaScreeningRow = {
  movie_id: string;
  cinema_id: string;
  starts_at: string;
  local_date: string;
  local_time: string;
  hall: string | null;
  ticket_url: string | null;
};

/**
 * Collapse source overlap to a tiny representative physical programme for
 * JSON-LD. The public Movie entity does not need a 30-day national programme
 * in its blocking loader; three upcoming physical screenings are enough to
 * publish useful ScreeningEvent examples without delaying navigation.
 */
export function representativeSchemaShowtimes(
  rows: SchemaScreeningRow[],
  limit = DEFAULT_SCHEMA_EVENT_LIMIT,
): Showtime[] {
  const byPhysicalStart = new Map<
    string,
    { row: SchemaScreeningRow; cinemaId: string; ticketUrl: string | null }
  >();

  for (const row of rows) {
    const cinemaId = canonicalCinemaId(row.cinema_id);
    const key = `${cinemaId}|${row.starts_at}`;
    const ticketUrl = normalizeTicketUrl(row.ticket_url) ?? null;
    const existing = byPhysicalStart.get(key);
    if (!existing) {
      byPhysicalStart.set(key, { row, cinemaId, ticketUrl });
    } else if (!existing.ticketUrl && ticketUrl) {
      existing.ticketUrl = ticketUrl;
    }
  }

  return [...byPhysicalStart.values()]
    .sort((a, b) => a.row.starts_at.localeCompare(b.row.starts_at))
    .slice(0, Math.max(0, limit))
    .map(({ row, cinemaId, ticketUrl }) => ({
      movieId: row.movie_id,
      cinemaId,
      date: row.local_date,
      times: [String(row.local_time).slice(0, 5)],
      hall: row.hall ?? "",
      bookingUrl: ticketUrl,
      ticketUrls: [ticketUrl ?? ""],
      formats: [],
      languages: [],
      events: [],
    }));
}

export async function fetchMovieSchemaProgramme(
  movieId: string | string[],
  limit = DEFAULT_SCHEMA_EVENT_LIMIT,
): Promise<{ cinemas: Cinema[]; showtimes: Showtime[] }> {
  const movieIds = Array.isArray(movieId) ? [...new Set(movieId)] : [movieId];
  if (movieIds.length === 0 || limit <= 0) return { cinemas: [], showtimes: [] };

  let query = supabase
    .from("screenings")
    .select("movie_id,cinema_id,starts_at,local_date,local_time,hall,ticket_url")
    .gte("starts_at", new Date().toISOString())
    .gte("local_date", windowStart())
    .lte("local_date", windowEnd());
  query = movieIds.length === 1 ? query.eq("movie_id", movieIds[0]!) : query.in("movie_id", movieIds);

  const { data, error } = await query
    .order("starts_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(Math.min(96, Math.max(limit * RAW_OVERSAMPLE, limit)));
  if (error) throw error;

  const showtimes = representativeSchemaShowtimes((data ?? []) as SchemaScreeningRow[], limit);
  const cinemaIds = [...new Set(showtimes.map((showtime) => showtime.cinemaId))];
  const cinemas = await fetchCinemasByIds(cinemaIds);
  return {
    cinemas: cinemas.filter((cinema) => cinemaIds.includes(cinema.id)),
    showtimes,
  };
}
