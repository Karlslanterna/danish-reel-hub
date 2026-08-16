import type { EbilletMoviesResponse } from "./api.server";

export type SnapshotValidation =
  | { ok: true; allowDeletes: true; reason: null }
  | { ok: false; allowDeletes: false; reason: string };
export type ValidateOptions = { existingRowCount: number; now?: Date };
const MAX_PAST_DAYS = 400;
const MAX_FUTURE_DAYS = 730;

export function sanitizeShowtimes(organizerId: number, payload: EbilletMoviesResponse, now = new Date()): EbilletMoviesResponse["showtimes"] {
  const nowMs = now.getTime();
  return payload.showtimes.filter((st) => {
    if (st.organizerId !== organizerId) return true;
    const ts = Date.parse(st.dateTime);
    if (!Number.isFinite(ts)) return false;
    const days = (ts - nowMs) / 86_400_000;
    return days >= -MAX_PAST_DAYS && days <= MAX_FUTURE_DAYS;
  });
}

export function validateSnapshot(organizerId: number, payload: EbilletMoviesResponse, opts: ValidateOptions): SnapshotValidation {
  const reject = (reason: string): SnapshotValidation => ({ ok: false, allowDeletes: false, reason });
  if (!payload.organizers.some((o) => o.id === organizerId)) return reject(`organizer ${organizerId} mangler i payload`);
  const showtimes = payload.showtimes.filter((s) => s.organizerId === organizerId);
  const ids = new Set<number>();
  for (const st of showtimes) {
    if (!Number.isFinite(st.id)) return reject("showtime uden gyldigt id");
    if (ids.has(st.id)) return reject(`duplikeret showtime id ${st.id}`);
    ids.add(st.id);
  }
  const movieIds = new Set(payload.movies.map((m) => m.id));
  for (const st of showtimes) if (!movieIds.has(st.movieId)) return reject(`showtime ${st.id} refererer ukendt film ${st.movieId}`);

  const now = opts.now ?? new Date();
  let invalidCount = 0;
  for (const st of showtimes) {
    const ts = Date.parse(st.dateTime);
    if (!Number.isFinite(ts)) return reject(`showtime ${st.id} har ugyldig dato`);
    const days = (ts - now.getTime()) / 86_400_000;
    if (days < -MAX_PAST_DAYS || days > MAX_FUTURE_DAYS) invalidCount += 1;
  }
  if (invalidCount / Math.max(showtimes.length, 1) > 0.25) return reject(`${invalidCount} af ${showtimes.length} showtimes har ugyldige/usandsynlige datoer`);

  const validCount = showtimes.length - invalidCount;
  if (validCount === 0 && opts.existingRowCount > 0) {
    const coherentlyEmpty = payload.movies.length === 0 && payload.movieBases.length === 0;
    if (!coherentlyEmpty) return reject(`tom showtime-liste men ${payload.movies.length} film i payload — afvist som mistænkelig`);
  }
  return { ok: true, allowDeletes: true, reason: null };
}

export const slugifyTitle = (value: string): string => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[æø]/g, (c) => (c === "æ" ? "ae" : "oe")).replace(/å/g, "aa").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
const stripYearSuffix = (title: string): string => title.replace(/\s*[([]\s*(?:19|20)\d{2}\s*[)\]]\s*$/u, "").trim();
export const titleKey = (value: string): string => slugifyTitle(stripYearSuffix(value));
export type MovieCandidate = { id: string; title: string; year: number | null; ebillet_movie_base_id: number | null; ebillet_movie_ids: number[] | null };
export type MovieMatchInput = { baseId: number | null; movieIds: number[]; title: string; year: number | null };
export function matchMovie(input: MovieMatchInput, candidates: MovieCandidate[]): MovieCandidate | null {
  if (input.baseId) { const byBase = candidates.find((c) => c.ebillet_movie_base_id === input.baseId); if (byBase) return byBase; }
  if (input.movieIds.length > 0) { const byMovieId = candidates.find((c) => (c.ebillet_movie_ids ?? []).some((id) => input.movieIds.includes(id))); if (byMovieId) return byMovieId; }
  const sameTitle = candidates.filter((c) => titleKey(c.title) === titleKey(input.title));
  if (sameTitle.length !== 1) return null;
  const only = sameTitle[0]!;
  if (input.year && only.year && Math.abs(only.year - input.year) <= 1) return only;
  return null;
}

export type DesiredShowtime = { movie_id: string; cinema_id: string; date: string; hall: string; times: string[]; ticket_urls: string[]; ticket_url: string | null; booking_url: string | null; start_time: string | null; formats: string[]; languages: string[]; events: string[]; ebillet_showtime_ids: number[]; free_seats: number | null; min_price: number | null; max_price: number | null; external_id: string };
export type ExistingShowtime = { id: string; movie_id: string; date: string; hall: string; source: string | null; ebillet_showtime_ids: number[] | null };
export type ShowtimeDiff = { inserts: DesiredShowtime[]; updates: Array<{ id: string; row: DesiredShowtime }>; deleteIds: string[] };
const isEbilletRow = (row: ExistingShowtime): boolean => (row.source ?? "").includes("ebillet") || (row.ebillet_showtime_ids ?? []).length > 0;
const rowKey = (r: { movie_id: string; date: string; hall: string }) => `${r.movie_id}|${r.date}|${r.hall}`;

export function diffShowtimes(existing: ExistingShowtime[], desired: DesiredShowtime[], opts: { allowDeletes: boolean } = { allowDeletes: true }): ShowtimeDiff {
  const now = Date.now();
  const validDesired = desired.filter((row) => {
    for (const time of row.times) {
      const ts = Date.parse(`${row.date}T${time}:00`);
      if (!Number.isFinite(ts)) return false;
      const days = (ts - now) / 86_400_000;
      if (days >= -MAX_PAST_DAYS && days <= MAX_FUTURE_DAYS) return true;
    }
    return false;
  });
  const ebilletRows = existing.filter(isEbilletRow);
  const byShowtimeId = new Map<number, ExistingShowtime>();
  for (const row of ebilletRows) for (const id of row.ebillet_showtime_ids ?? []) if (!byShowtimeId.has(id)) byShowtimeId.set(id, row);
  const byKey = new Map<string, ExistingShowtime>();
  for (const row of ebilletRows) if (!byKey.has(rowKey(row))) byKey.set(rowKey(row), row);
  const inserts: DesiredShowtime[] = [];
  const updates: Array<{ id: string; row: DesiredShowtime }> = [];
  const matched = new Set<string>();
  for (const row of validDesired) {
    let hit: ExistingShowtime | undefined;
    for (const id of row.ebillet_showtime_ids) { const candidate = byShowtimeId.get(id); if (candidate && !matched.has(candidate.id)) { hit = candidate; break; } }
    if (!hit) { const candidate = byKey.get(rowKey(row)); if (candidate && !matched.has(candidate.id)) hit = candidate; }
    if (hit) { matched.add(hit.id); updates.push({ id: hit.id, row }); } else inserts.push(row);
  }
  const deleteIds = opts.allowDeletes ? ebilletRows.filter((r) => !matched.has(r.id)).map((r) => r.id) : [];
  return { inserts, updates, deleteIds };
}
