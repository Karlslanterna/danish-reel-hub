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
import { copenhagenParts } from "@/lib/pipeline/localtime";
import type { NormalizedScreening } from "@/lib/pipeline/types";
import { extractTags } from "@/lib/showtime-tags";
import {
  ebilletDateTimeToUtcIso,
  isPlausibleEbilletDateTime,
} from "./showtime-validity";

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

/**
 * Showtime ids are scoped by organizer. Even if eBillet currently allocates
 * them globally, encoding the organizer makes the identity collision-proof
 * and keeps promotion strictly inside one cinema scope.
 */
export const screeningRefOf = (organizerId: number, showtimeId: number): string =>
  `eb-${organizerId}-${showtimeId}`;

const clean = (html: string | null | undefined): string =>
  (html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** Instant for a showtime; eBillet emits Danish wall clock, sometimes offset-less. */
export function ebilletStartsAt(dateTime: string): string {
  return ebilletDateTimeToUtcIso(dateTime);
}

/** Collapse payload versions into one group per canonical film. */
export function buildMovieGroups(
  payload: EbilletMoviesResponse,
  now = new Date(),
): EbilletMovieGroup[] {
  const movieById = new Map<number, EbilletMovie>(payload.movies.map((m) => [m.id, m]));
  const baseById = new Map<number, EbilletMovieBase>(payload.movieBases.map((b) => [b.id, b]));

  const seen = new Map<string, { baseId: number | null; movieIds: number[]; primary: number }>();
  for (const st of payload.showtimes) {
    if (!isPlausibleEbilletDateTime(st.dateTime, now)) continue;
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
  now = new Date(),
): NormalizedScreening[] {
  const movieById = new Map<number, EbilletMovie>(payload.movies.map((m) => [m.id, m]));
  const baseById = new Map<number, EbilletMovieBase>(payload.movieBases.map((b) => [b.id, b]));
  const typeName = new Map(payload.showtimeTypes.map((t) => [String(t.id), t.name]));
  const out: NormalizedScreening[] = [];
  const seenRefs = new Set<string>();
  const seenPhysical = new Set<string>();

  // eBillet can expose multiple booking ids for the same physical screening.
  // Prefer a bookable row, then the lowest source id for deterministic identity.
  // If that preferred id changes later, the promotion RPC reconciles the new
  // source_ref against the stable physical identity atomically.
  const relevant = payload.showtimes
    .filter((st: EbilletShowtime) => st.organizerId === organizerId)
    .sort((a, b) => {
      const aDisabled = a.buyInfo?.enabled === false ? 1 : 0;
      const bDisabled = b.buyInfo?.enabled === false ? 1 : 0;
      return aDisabled - bDisabled || a.id - b.id;
    });

  for (const st of relevant) {
    if (!isPlausibleEbilletDateTime(st.dateTime, now)) continue;
    const movie = movieById.get(st.movieId);
    if (!movie) continue;
    const ref = screeningRefOf(organizerId, st.id);
    if (seenRefs.has(ref)) continue;

    let startsAt: string;
    try {
      startsAt = ebilletStartsAt(st.dateTime);
    } catch {
      continue;
    }

    const sourceMovieRef = movieRefOf(movie);
    const hall = (st.locationName ?? "").trim() || "Sal";
    const physicalKey = `${sourceMovieRef}\u001f${startsAt}\u001f${hall}`;
    if (seenPhysical.has(physicalKey)) continue;

    const { date, time } = copenhagenParts(startsAt);
    const base = movie.baseId && movie.baseId > 0 ? baseById.get(movie.baseId) : undefined;
    const eventName = st.type != null ? typeName.get(String(st.type)) : undefined;
    const tags = extractTags(
      base?.name,
      movie.name,
      movie.subName,
      movie.originalName,
      eventName,
      st.locationName,
    );
    const formats: string[] = [movie.is3D || movie.dimension === "3" ? "3D" : "2D"];
    for (const format of tags.formats) if (!formats.includes(format)) formats.push(format);
    if (movie.isAtmos) formats.push("Atmos");
    const min = st.minPrice != null ? Number(st.minPrice) : null;
    const max = st.maxPrice != null ? Number(st.maxPrice) : null;

    seenRefs.add(ref);
    seenPhysical.add(physicalKey);
    out.push({
      sourceRef: ref,
      sourceCinemaRef: String(organizerId),
      sourceMovieRef,
      startsAt,
      localDate: date,
      localTime: time,
      hall,
      ticketUrl: ebilletBookingUrl(organizerId, st.movieId, st.id),
      priceMin: min !== null && Number.isFinite(min) ? min : null,
      priceMax: max !== null && Number.isFinite(max) ? max : null,
      freeSeats: typeof st.freeSeats === "number" ? st.freeSeats : null,
      formats,
      languages: tags.languages,
      events: tags.events,
    });
  }
  return out.sort(
    (a, b) => a.startsAt.localeCompare(b.startsAt) || a.sourceRef.localeCompare(b.sourceRef),
  );
}
