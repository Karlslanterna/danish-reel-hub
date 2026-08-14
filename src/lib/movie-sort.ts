/**
 * Reusable movie-ordering strategies.
 *
 * Ordering is always resolved in the database (against the `movies_ranked`
 * view, which aggregates upcoming screenings live), never in the frontend.
 * Add a new strategy here and it becomes available everywhere.
 */
export type MovieSortStrategy =
  | "most-screenings"
  | "newest"
  | "top-rated"
  | "title";

export const DEFAULT_MOVIE_SORT: MovieSortStrategy = "most-screenings";

type OrderClause = { column: string; ascending: boolean; nullsFirst?: boolean };

/**
 * Ordered list of `.order()` clauses per strategy. Every strategy ends with
 * the same tie breakers: earliest upcoming screening, then title A→Å.
 */
const TIE_BREAKERS: OrderClause[] = [
  { column: "next_screening_date", ascending: true, nullsFirst: false },
  { column: "title", ascending: true },
];

export const MOVIE_SORT_ORDERS: Record<MovieSortStrategy, OrderClause[]> = {
  "most-screenings": [
    { column: "screening_count", ascending: false },
    ...TIE_BREAKERS,
  ],
  newest: [
    { column: "release_date", ascending: false, nullsFirst: false },
    { column: "year", ascending: false },
    ...TIE_BREAKERS,
  ],
  "top-rated": [
    { column: "tmdb_vote_average", ascending: false, nullsFirst: false },
    ...TIE_BREAKERS,
  ],
  title: [{ column: "title", ascending: true }],
};

export const MOVIE_SORT_LABELS: Record<MovieSortStrategy, { da: string; en: string }> = {
  "most-screenings": { da: "Flest visninger", en: "Most screenings" },
  newest: { da: "Nyeste film", en: "Newest releases" },
  "top-rated": { da: "Bedst bedømt", en: "Highest rated" },
  title: { da: "Alfabetisk", en: "Alphabetical" },
};

type RankableEntry = { movieId: string; date: string; times?: string[] };
type RankableMovie = { id: string; title: string };

/**
 * Client-side equivalent of the `movies_ranked` ordering, applied to the
 * screenings that survived the active filters: most screenings first, then
 * earliest upcoming screening, then title A→Å.
 */
export function rankMoviesByScreenings<T extends RankableMovie>(
  movies: T[],
  entries: RankableEntry[],
): T[] {
  const stats = new Map<string, { count: number; next: string | null }>();
  for (const e of entries) {
    const s = stats.get(e.movieId) ?? { count: 0, next: null };
    s.count += e.times?.length ?? 1;
    if (!s.next || e.date < s.next) s.next = e.date;
    stats.set(e.movieId, s);
  }
  return [...movies].sort((a, b) => {
    const sa = stats.get(a.id) ?? { count: 0, next: null };
    const sb = stats.get(b.id) ?? { count: 0, next: null };
    if (sb.count !== sa.count) return sb.count - sa.count;
    if (sa.next !== sb.next) {
      if (!sa.next) return 1;
      if (!sb.next) return -1;
      return sa.next < sb.next ? -1 : 1;
    }
    return a.title.localeCompare(b.title, "da");
  });
}
