/**
 * Pure, testable helpers that enforce source authority for the Kultunaut
 * importer.
 *
 * Rules (phase 1 of the import-architecture migration):
 *  - Kultunaut may only create/update/delete showtimes on cinemas it owns,
 *    i.e. cinemas that are NOT linked to an eBillet organizer at all.
 *    Ownership is the LINK (`cinemas.ebillet_organizer_id` /
 *    `ebillet_organizers.cinema_id`), never the organizer's `is_active` flag —
 *    `is_active` only says whether the organizer currently has screenings,
 *    which is visibility, not authority.
 *  - Every Kultunaut write carries `source = 'kultunaut'` explicitly.
 *  - Cleanup is source-scoped: it never touches eBillet rows and never
 *    deletes cinemas.
 */

export const KULTUNAUT_SOURCE = "kultunaut";

export type ShowtimeKeyed = {
  movie_id: string;
  cinema_id: string;
  date: string;
  hall: string;
};

export const showtimeKey = (row: ShowtimeKeyed): string =>
  `${row.movie_id}|${row.cinema_id}|${row.date}|${row.hall}`;

/**
 * True when the cinema is linked to an eBillet organizer (any status) and is
 * therefore off-limits to Kultunaut writes and Kultunaut cleanup.
 */
export const isEbilletOwned = (cinemaId: string, ebilletCinemaIds: Set<string>): boolean =>
  ebilletCinemaIds.has(cinemaId);

/**
 * Split a batch of feed rows into the ones Kultunaut is allowed to write and
 * the ones that belong to an eBillet-authoritative cinema.
 */
export function partitionByAuthority<T extends { cinema_id: string }>(
  rows: T[],
  ebilletCinemaIds: Set<string>,
): { writable: T[]; skipped: T[] } {
  const writable: T[] = [];
  const skipped: T[] = [];
  for (const row of rows) {
    if (isEbilletOwned(row.cinema_id, ebilletCinemaIds)) skipped.push(row);
    else writable.push(row);
  }
  return { writable, skipped };
}

export type ExistingShowtimeRow = ShowtimeKeyed & { id: string; source: string | null };

/**
 * Ids of showtimes that should be removed after a full Kultunaut import.
 *
 * A row is only stale when ALL of these hold:
 *  - it is a Kultunaut row (`source = 'kultunaut'`)
 *  - its cinema is Kultunaut-authoritative (not linked to any eBillet organizer)
 *  - the current feed no longer contains its (movie, cinema, date, hall) key
 *
 * eBillet rows and rows on eBillet-owned cinemas are never returned — those
 * are removed exclusively by the eBillet sync.
 */
export function staleKultunautShowtimeIds(
  existing: ExistingShowtimeRow[],
  desired: ShowtimeKeyed[],
  ebilletCinemaIds: Set<string>,
): string[] {
  const keep = new Set(desired.map(showtimeKey));
  return existing
    .filter((row) => (row.source ?? "") === KULTUNAUT_SOURCE)
    .filter((row) => !isEbilletOwned(row.cinema_id, ebilletCinemaIds))
    .filter((row) => !keep.has(showtimeKey(row)))
    .map((row) => row.id);
}
