/**
 * Pure normalization of an eBillet payload into pipeline shapes.
 *
 * eBillet models a film as a "movie base" with one or more concrete "movies"
 * (3D, dubbed, original …). The base id is the primary external identity;
 * a version-only film falls back to its movie id. Both forms are stable and
 * are what `source_entity_refs` stores.
 */
import type {
  EbilletMovie,
  EbilletMovieBase,
  EbilletMoviesResponse,
  EbilletShowtime,
} from "./api.server";
import { ebilletBookingUrl, parseRuntimeMinutes } from "./api.server";
import { copenhagenParts, copenhagenToUtcIso } from "@/lib/pipeline/localtime";
import type { NormalizedScreening } from "@/lib/pipeline/types";

export type EbilletMovieGroup = {
  /** Source-native movie ref: `base-<id>` or `movie-<id>`. */
  ref: string;
  baseId: number | null;
  movieIds: number[];
  title: string;
  originalTitle: string | null;
  runtime: number;
  year: number;
  genres: string[];
  director: string;
  rating: string;
  synopsis: string;
  posterUrl: string | null;
  trailerUrl: string | null;
};

export const movieRefOf = (movie: { id: number; baseId?: number | null }): string =>
  movie.baseId && movie.baseId > 0 ? `base-${movie.baseId}` : `movie-${movie.id}`;

export const screeningRefOf = (showtimeId: number): string => `eb-${showtimeId}`;

const clean = (html: string | null | undefined): string =>
  (html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** Instant for a showtime; eBillet emits Danish wall clock, sometimes offset-less. */
export function ebilletStartsAt(dateTime: string): string {
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(dateTime.trim());
  if (hasZone) return new Date(dateTime).toISOString();
  return copenhagenToUtcIso(dateTime.slice(0, 10), dateTime.slice(11, 16));
}

/** Collapse payload versions into one group per canonical film. */
export function buildMovieGroups(payload: EbilletMoviesResponse): EbilletMovieGroup[] {
  const movieById = new Map<number, EbilletMovie>(payload.movies.map((m) => [m.id, m]));
  const baseById = new Map<number, EbilletMovieBase>(payload.movieBases.map((b) => [b.id, b]));

  const seen = new Map<string, { baseId: number | null; movieIds: number[]; primary: number }>();
  for (const st of payload.showtimes) {
    const movie = movieById.get(st.movieId);
    if (!movie) continue;
    const ref = movieRefOf(movie);
    const g = seen.get(ref) ?? {
      baseId: movie.baseId && movie.baseId > 0 ? movie.baseId : null,
      movieIds: [],
      primary: movie.id,
    };
    if (!g.movieIds.includes(movie.id)) g.movieIds.push(movie.id);
    seen.set(ref, g);
  }

  const groups: EbilletMovieGroup[] = [];
  for (const [ref, g] of seen) {
    const primary = movieById.get(g.primary);
    if (!primary) continue;
    const base = g.baseId ? baseById.get(g.baseId) : undefined;
    const title = (base?.name ?? primary.name ?? "").trim();
    if (!title) continue;
    const posters = base?.posters ?? primary.posters ?? {};
    const parsedYear = primary.openingDate
      ? Number.parseInt(primary.openingDate.slice(0, 4), 10)
      : Number.NaN;
    groups.push({
      ref,
      baseId: g.baseId,
      movieIds: [...g.movieIds].sort((a, b) => a - b),
      title,
      originalTitle: primary.originalName || null,
      runtime: parseRuntimeMinutes(primary.length),
      year: Number.isFinite(parsedYear) && parsedYear > 1900 ? parsedYear : 0,
      genres: primary.genre
        ? primary.genre.split(/[,/]/).map((s) => s.trim()).filter(Boolean)
        : [],
      director: primary.directors?.join(", ") ?? "",
      rating: primary.ageCensoring ?? "",
      synopsis: clean(primary.description ?? primary.shortDescription),
      posterUrl: posters.hd || posters.large || posters.small || null,
      trailerUrl: primary.trailer ?? null,
    });
  }
  return groups.sort((a, b) => a.ref.localeCompare(b.ref));
}

/** One row per physical screening — never grouped by date/hall. */
export function normalizeEbilletScreenings(
  organizerId: number,
  payload: EbilletMoviesResponse,
): NormalizedScreening[] {
  const movieById = new Map<number, EbilletMovie>(payload.movies.map((m) => [m.id, m]));
  const typeName = new Map(payload.showtimeTypes.map((t) => [String(t.id), t.name]));
  const out: NormalizedScreening[] = [];
  const seen = new Set<string>();

  const relevant = payload.showtimes.filter(
    (st: EbilletShowtime) => st.organizerId === organizerId,
  );
  for (const st of relevant) {
    const movie = movieById.get(st.movieId);
    if (!movie) continue;
    const ref = screeningRefOf(st.id);
    if (seen.has(ref)) continue;
    let startsAt: string;
    try {
      startsAt = ebilletStartsAt(st.dateTime);
    } catch {
      continue;
    }
    const { date, time } = copenhagenParts(startsAt);
    const formats: string[] = [movie.is3D || movie.dimension === "3" ? "3D" : "2D"];
    if (movie.isAtmos) formats.push("Atmos");
    const eventName = st.type != null ? typeName.get(String(st.type)) : undefined;
    const min = st.minPrice != null ? Number(st.minPrice) : null;
    const max = st.maxPrice != null ? Number(st.maxPrice) : null;

    seen.add(ref);
    out.push({
      sourceRef: ref,
      sourceCinemaRef: String(organizerId),
      sourceMovieRef: movieRefOf(movie),
      startsAt,
      localDate: date,
      localTime: time,
      hall: (st.locationName ?? "").trim() || "Sal",
      ticketUrl: ebilletBookingUrl(organizerId, st.movieId, st.id),
      priceMin: min !== null && Number.isFinite(min) ? min : null,
      priceMax: max !== null && Number.isFinite(max) ? max : null,
      freeSeats: typeof st.freeSeats === "number" ? st.freeSeats : null,
      formats,
      languages: [],
      events: eventName ? [eventName] : [],
    });
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.sourceRef.localeCompare(b.sourceRef));
}
