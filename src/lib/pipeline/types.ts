/**
 * Shared vocabulary for the source-scoped import pipeline:
 *
 *   fetch -> validate -> normalize -> resolve -> stage -> promote
 *
 * Everything in this file is pure data, safe to import from tests and from
 * the client bundle.
 */

export type ImportSource = "ebillet" | "kultunaut";

/** One physical screening as it exists in a source payload, pre-resolution. */
export type NormalizedScreening = {
  /** Stable identity of this screening within the source. */
  sourceRef: string;
  /** Source-native cinema identity (organizer id / theater id). */
  sourceCinemaRef: string;
  /** Source-native movie identity. */
  sourceMovieRef: string;
  /** UTC instant, ISO-8601. Canonical. */
  startsAt: string;
  /** Copenhagen wall clock, derived from startsAt. Display only. */
  localDate: string;
  localTime: string;
  hall: string;
  ticketUrl: string | null;
  priceMin: number | null;
  priceMax: number | null;
  freeSeats: number | null;
  formats: string[];
  languages: string[];
  events: string[];
};

/** A row handed to the `promote_screenings` RPC (snake_case = SQL shape). */
export type PromotionRow = {
  source_ref: string;
  movie_id: string;
  starts_at: string;
  hall: string;
  ticket_url: string | null;
  price_min: number | null;
  price_max: number | null;
  free_seats: number | null;
  formats: string[];
  languages: string[];
  events: string[];
};

export type SnapshotVerdict = "complete" | "valid-empty" | "incomplete";

export type SnapshotValidation = {
  verdict: SnapshotVerdict;
  reasons: string[];
  stats: Record<string, number>;
};

/** A source entity that could not be bound to a canonical row. */
export type UnresolvedEntity = {
  source: ImportSource;
  entityType: "cinema" | "movie";
  externalId: string;
  label: string;
  reason: string;
  payload?: Record<string, unknown>;
};

export type PromotionResult = {
  inserted: number;
  updated: number;
  deleted: number;
  unchanged: number;
};

export const emptyPromotion = (): PromotionResult => ({
  inserted: 0,
  updated: 0,
  deleted: 0,
  unchanged: 0,
});

export function addPromotion(a: PromotionResult, b: PromotionResult): PromotionResult {
  return {
    inserted: a.inserted + b.inserted,
    updated: a.updated + b.updated,
    deleted: a.deleted + b.deleted,
    unchanged: a.unchanged + b.unchanged,
  };
}

/** Convert a normalized screening + resolved movie into an RPC row. */
export function toPromotionRow(s: NormalizedScreening, movieId: string): PromotionRow {
  return {
    source_ref: s.sourceRef,
    movie_id: movieId,
    starts_at: s.startsAt,
    hall: s.hall,
    ticket_url: s.ticketUrl,
    price_min: s.priceMin,
    price_max: s.priceMax,
    free_seats: s.freeSeats,
    formats: s.formats,
    languages: s.languages,
    events: s.events,
  };
}

/** Deduplicate normalized screenings by source ref (last write wins). */
export function dedupeBySourceRef(rows: NormalizedScreening[]): NormalizedScreening[] {
  const map = new Map<string, NormalizedScreening>();
  for (const r of rows) map.set(r.sourceRef, r);
  return [...map.values()];
}

/** Group normalized screenings by their source cinema ref. */
export function groupByCinemaRef(
  rows: NormalizedScreening[],
): Map<string, NormalizedScreening[]> {
  const out = new Map<string, NormalizedScreening[]>();
  for (const r of rows) {
    const list = out.get(r.sourceCinemaRef);
    if (list) list.push(r);
    else out.set(r.sourceCinemaRef, [r]);
  }
  return out;
}
