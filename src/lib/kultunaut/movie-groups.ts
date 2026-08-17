import type { ParsedMovie } from "./parser.server";
import { kultunautMovieGroupKey } from "./movie-dedup";

export type KultunautMovieGroup = {
  key: string;
  primary: ParsedMovie;
  externalIds: string[];
};

export function movieMetadataScore(movie: ParsedMovie): number {
  let score = 0;
  const posters = [movie.poster.a, movie.poster.b, movie.poster.c, movie.poster.d, movie.poster.url];
  if (posters.some((value) => value && value.trim() !== "")) score += 10;
  if (movie.runtime > 0) score += 5;
  if (movie.synopsis.trim().length > 20) score += 3;
  if (movie.director.trim() !== "") score += 2;
  if (movie.rating.trim() !== "") score += 1;
  if (movie.genre.length > 0) score += 1;
  if (movie.original_title?.trim()) score += 1;
  return score;
}

/**
 * Collapse only source records with the same normalized title AND a known,
 * equal year. Unknown-year records remain independent external identities.
 */
export function buildKultunautMovieGroups(
  movies: Iterable<ParsedMovie>,
): KultunautMovieGroup[] {
  const grouped = new Map<string, ParsedMovie[]>();
  for (const movie of movies) {
    const key = kultunautMovieGroupKey(movie, movie.external_id);
    grouped.set(key, [...(grouped.get(key) ?? []), movie]);
  }

  return [...grouped.entries()]
    .map(([key, members]) => {
      const ranked = [...members].sort(
        (a, b) =>
          movieMetadataScore(b) - movieMetadataScore(a) ||
          a.external_id.localeCompare(b.external_id),
      );
      return {
        key,
        primary: ranked[0]!,
        externalIds: ranked.map((movie) => movie.external_id).sort(),
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}
