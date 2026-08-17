/**
 * Thin, server-only client for eBillet's public flow API.
 *
 * Documented surface (no credentials required, read-only):
 *   GET https://flow.ebillet.dk/api/movies?organizerIds=177,195
 *
 * The response contains `organizers`, `movieBases`, `movies`, `showtimes`
 * and `showtimeTypes`. eBillet exposes no organizer directory endpoint, so
 * organizer discovery is done by probing the id space in small batches —
 * the API silently ignores unknown ids and only returns organizers that
 * exist (see discoverOrganizers in ./discovery.server).
 */

export const EBILLET_API_BASE = "https://flow.ebillet.dk/api";
const USER_AGENT = "KarlVictor";

export type EbilletAddress = {
  roadAndNumber?: string | null;
  zip?: string | null;
  city?: string | null;
  region?: string | null;
};
export type EbilletOrganizer = {
  id: number;
  name: string;
  address?: EbilletAddress | null;
  locations?: Array<{ id: number; name: string; seatCount?: number }> | null;
};
export type EbilletPosters = { small?: string | null; large?: string | null; hd?: string | null };
export type EbilletMovieBase = { id: number; name: string; posters?: EbilletPosters | null };
export type EbilletMovie = {
  id: number; baseId: number; type?: string | null; name: string; subName?: string | null;
  originalName?: string | null; description?: string | null; shortDescription?: string | null;
  posters?: EbilletPosters | null; trailer?: string | null; genre?: string | null;
  length?: string | null; openingDate?: string | null; ageCensoring?: string | null;
  dimension?: string | null; is3D?: boolean | null; isAtmos?: boolean | null; directors?: string[] | null;
};
export type EbilletShowtime = {
  id: number; movieId: number; movieBaseId: number; locationId: number; locationName?: string | null;
  type?: number | string | null; dateTime: string; freeSeats?: number | null; organizerId: number;
  minPrice?: string | number | null; maxPrice?: string | number | null; buyInfo?: { enabled?: boolean } | null;
};
export type EbilletMoviesResponse = {
  organizers: EbilletOrganizer[]; movieBases: EbilletMovieBase[]; movies: EbilletMovie[];
  showtimes: EbilletShowtime[]; showtimeTypes: Array<{ id: number; name: string }>;
};
const EMPTY: EbilletMoviesResponse = { organizers: [], movieBases: [], movies: [], showtimes: [], showtimeTypes: [] };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch an eBillet payload with a hard per-request deadline.
 * A stuck upstream request must never consume the whole sync invocation.
 */
export async function fetchOrganizerPayload(
  organizerIds: number[],
  opts: { attempts?: number; timeoutMs?: number } = {},
): Promise<EbilletMoviesResponse> {
  if (organizerIds.length === 0) return EMPTY;
  const attempts = opts.attempts ?? 2;
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const url = `${EBILLET_API_BASE}/movies?organizerIds=${organizerIds.join(",")}`;

  let lastError = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`eBillet HTTP ${res.status}`);
      const json = (await res.json()) as Partial<EbilletMoviesResponse>;
      return {
        organizers: json.organizers ?? [], movieBases: json.movieBases ?? [], movies: json.movies ?? [],
        showtimes: json.showtimes ?? [], showtimeTypes: json.showtimeTypes ?? [],
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < attempts) await sleep(500);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw new Error(`eBillet request failed (${organizerIds.join(",")}): ${lastError}`);
}

/**
 * eBillet's public booking route is /billetter/<movie>/<showtime>?org=<organizer>.
 * Use the generic flow.ebillet.dk host rather than cinema-specific branded
 * hosts so links remain portable when opened directly from Lanterna.
 */
export function ebilletBookingUrl(organizerId: number, movieId: number, showtimeId: number): string {
  return `https://flow.ebillet.dk/billetter/${movieId}/${showtimeId}?org=${organizerId}`;
}

export function parseRuntimeMinutes(length?: string | null): number {
  if (!length) return 0;
  const parts = length.split(":").map((p) => Number.parseInt(p, 10));
  if (parts.some((p) => Number.isNaN(p))) return 0;
  const [h = 0, m = 0] = parts;
  return h * 60 + m;
}
