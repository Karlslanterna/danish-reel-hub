/**
 * Pure helpers for eBillet snapshot reconciliation.
 *
 * eBillet is the authoritative showtime source for every cinema linked to an
 * eBillet organizer. Each sync therefore treats the API payload as a full
 * *snapshot* for that organizer: screenings that disappeared from the snapshot
 * are removed, new ones inserted, existing ones refreshed.
 *
 * Because that is destructive, the payload is validated first — an API hiccup
 * (missing organizer, structurally incomplete body, suspicious empty result)
 * must never wipe a populated cinema.
 *
 * Everything here is pure so it can be unit-tested without a database.
 */

import type { EbilletMoviesResponse } from "./api.server";

// ------------------------------------------------------------- validation

export type SnapshotValidation =
  | { ok: true; allowDeletes: true; reason: null }
  | { ok: false; allowDeletes: false; reason: string };

export type ValidateOptions = {
  /** How many eBillet showtime rows the cinema currently has in the DB. */
  existingRowCount: number;
  /** Reference "now" — injectable for tests. */
  now?: Date;
};

const MAX_PAST_DAYS = 400;
const MAX_FUTURE_DAYS = 730;

/**
 * Decide whether a payload is trustworthy enough to reconcile destructively.
 */
export function validateSnapshot(
  organizerId: number,
  payload: EbilletMoviesResponse,
  opts: ValidateOptions,
): SnapshotValidation {
  const reject = (reason: string): SnapshotValidation => ({
    ok: false,
    allowDeletes: false,
    reason,
  });

  if (!payload.organizers.some((o) => o.id === organizerId)) {
    return reject(`organizer ${organizerId} mangler i payload`);
  }

  const showtimes = payload.showtimes.filter((s) => s.organizerId === organizerId);

  const ids = new Set<number>();
  for (const st of showtimes) {
    if (!Number.isFinite(st.id)) return reject("showtime uden gyldigt id");
    if (ids.has(st.id)) return reject(`duplikeret showtime id ${st.id}`);
    ids.add(st.id);
  }

  const movieIds = new Set(payload.movies.map((m) => m.id));
  for (const st of showtimes) {
    if (!movieIds.has(st.movieId)) {
      return reject(`showtime ${st.id} refererer ukendt film ${st.movieId}`);
    }
  }

  const now = opts.now ?? new Date();
  for (const st of showtimes) {
    const ts = Date.parse(st.dateTime);
    if (!Number.isFinite(ts)) return reject(`showtime ${st.id} har ugyldig dato`);
    const days = (ts - now.getTime()) / 86_400_000;
    if (days < -MAX_PAST_DAYS || days > MAX_FUTURE_DAYS) {
      return reject(`showtime ${st.id} har usandsynlig dato ${st.dateTime}`);
    }
  }

  if (showtimes.length === 0 && opts.existingRowCount > 0) {
    // An empty snapshot is only trusted when the payload is *coherently*
    // empty (no movie catalogue either). A payload that lists films but no
    // screenings is structurally incomplete and must not wipe the cinema.
    const coherentlyEmpty = payload.movies.length === 0 && payload.movieBases.length === 0;
    if (!coherentlyEmpty) {
      return reject(
        `tom showtime-liste men ${payload.movies.length} film i payload — afvist som mistænkelig`,
      );
    }
  }

  return { ok: true, allowDeletes: true, reason: null };
}

// ------------------------------------------------------------- movie match

export const slugifyTitle = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[æø]/g, (c) => (c === "æ" ? "ae" : "oe"))
    .replace(/å/g, "aa")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";

const stripYearSuffix = (title: string): string =>
  title.replace(/\s*[([]\s*(?:19|20)\d{2}\s*[)\]]\s*$/u, "").trim();

export const titleKey = (value: string): string => slugifyTitle(stripYearSuffix(value));

export type MovieCandidate = {
  id: string;
  title: string;
  year: number | null;
  ebillet_movie_base_id: number | null;
  ebillet_movie_ids: number[] | null;
};

export type MovieMatchInput = {
  baseId: number | null;
  movieIds: number[];
  title: string;
  year: number | null;
};

/**
 * Find the Lanterna movie an eBillet movie group belongs to.
 *
 * Order: eBillet baseId → known eBillet movie ids → title + matching year.
 * A normalised title alone is NOT enough (too many collisions: remakes,
 * re-releases, generic titles) — in that case we return null and the caller
 * creates a new movie instead of risking a wrong merge.
 */
export function matchMovie(
  input: MovieMatchInput,
  candidates: MovieCandidate[],
): MovieCandidate | null {
  if (input.baseId) {
    const byBase = candidates.find((c) => c.ebillet_movie_base_id === input.baseId);
    if (byBase) return byBase;
  }
  if (input.movieIds.length > 0) {
    const byMovieId = candidates.find((c) =>
      (c.ebillet_movie_ids ?? []).some((id) => input.movieIds.includes(id)),
    );
    if (byMovieId) return byMovieId;
  }

  const key = titleKey(input.title);
  const sameTitle = candidates.filter((c) => titleKey(c.title) === key);
  if (sameTitle.length !== 1) return null; // 0 = new film, >1 = ambiguous
  const only = sameTitle[0]!;

  // Require the year to agree when both sides know it; if either side has no
  // year we cannot prove it is the same film, so we do not merge.
  if (input.year && only.year && Math.abs(only.year - input.year) <= 1) return only;
  return null;
}

// -------------------------------------------------------------- showtimes

export type DesiredShowtime = {
  movie_id: string;
  cinema_id: string;
  date: string;
  hall: string;
  times: string[];
  ticket_urls: string[];
  ticket_url: string | null;
  booking_url: string | null;
  start_time: string | null;
  formats: string[];
  languages: string[];
  events: string[];
  ebillet_showtime_ids: number[];
  free_seats: number | null;
  min_price: number | null;
  max_price: number | null;
  external_id: string;
};

export type ExistingShowtime = {
  id: string;
  movie_id: string;
  date: string;
  hall: string;
  source: string | null;
  ebillet_showtime_ids: number[] | null;
};

export type ShowtimeDiff = {
  inserts: DesiredShowtime[];
  updates: Array<{ id: string; row: DesiredShowtime }>;
  deleteIds: string[];
};

const isEbilletRow = (row: ExistingShowtime): boolean =>
  (row.source ?? "").includes("ebillet") || (row.ebillet_showtime_ids ?? []).length > 0;

const rowKey = (r: { movie_id: string; date: string; hall: string }) =>
  `${r.movie_id}|${r.date}|${r.hall}`;

/**
 * Diff a validated snapshot against the cinema's current eBillet rows.
 *
 * Identity is taken from the stable eBillet showtime ids when available and
 * falls back to (movie, date, hall). Rows that are not eBillet-sourced (i.e.
 * Kultunaut-only rows) are never touched.
 */
export function diffShowtimes(
  existing: ExistingShowtime[],
  desired: DesiredShowtime[],
  opts: { allowDeletes: boolean } = { allowDeletes: true },
): ShowtimeDiff {
  const ebilletRows = existing.filter(isEbilletRow);

  const byShowtimeId = new Map<number, ExistingShowtime>();
  for (const row of ebilletRows) {
    for (const id of row.ebillet_showtime_ids ?? []) {
      if (!byShowtimeId.has(id)) byShowtimeId.set(id, row);
    }
  }
  const byKey = new Map<string, ExistingShowtime>();
  for (const row of ebilletRows) {
    if (!byKey.has(rowKey(row))) byKey.set(rowKey(row), row);
  }

  const inserts: DesiredShowtime[] = [];
  const updates: Array<{ id: string; row: DesiredShowtime }> = [];
  const matched = new Set<string>();

  for (const row of desired) {
    let hit: ExistingShowtime | undefined;
    for (const id of row.ebillet_showtime_ids) {
      const candidate = byShowtimeId.get(id);
      if (candidate && !matched.has(candidate.id)) {
        hit = candidate;
        break;
      }
    }
    if (!hit) {
      const candidate = byKey.get(rowKey(row));
      if (candidate && !matched.has(candidate.id)) hit = candidate;
    }
    if (hit) {
      matched.add(hit.id);
      updates.push({ id: hit.id, row });
    } else {
      inserts.push(row);
    }
  }

  const deleteIds = opts.allowDeletes
    ? ebilletRows.filter((r) => !matched.has(r.id)).map((r) => r.id)
    : [];

  return { inserts, updates, deleteIds };
}
