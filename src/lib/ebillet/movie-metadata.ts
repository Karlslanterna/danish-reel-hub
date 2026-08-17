import type { EbilletMovieGroup } from "./normalize";

export type ExistingMovieMetadata = {
  year: number | null;
  runtime: number | null;
  synopsis: string | null;
  director: string | null;
  genre: string[] | null;
  poster: Record<string, unknown> | null;
  trailer_url: string | null;
  ebillet_movie_base_id: number | null;
  ebillet_movie_ids: number[] | null;
};

const blank = (value: unknown): boolean =>
  value == null || (typeof value === "string" && value.trim() === "");

/**
 * eBillet is authoritative for screening identity, but film metadata is
 * supplemental: populate missing source metadata and identity fields without
 * overwriting an already useful value.
 */
export function buildEbilletMovieSupplementPatch(
  existing: ExistingMovieMetadata,
  group: EbilletMovieGroup,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const mergedIds = [...new Set([...(existing.ebillet_movie_ids ?? []), ...group.movieIds])].sort(
    (a, b) => a - b,
  );

  if (
    mergedIds.length !== (existing.ebillet_movie_ids ?? []).length ||
    mergedIds.some((id, i) => id !== (existing.ebillet_movie_ids ?? [])[i])
  ) {
    patch.ebillet_movie_ids = mergedIds;
  }
  if (group.baseId && !existing.ebillet_movie_base_id) patch.ebillet_movie_base_id = group.baseId;
  if ((!existing.year || existing.year <= 0) && group.year > 0) patch.year = group.year;
  if ((!existing.runtime || existing.runtime <= 0) && group.runtime > 0) patch.runtime = group.runtime;
  if (blank(existing.synopsis) && group.synopsis) patch.synopsis = group.synopsis;
  if (blank(existing.director) && group.director) patch.director = group.director;
  if ((existing.genre ?? []).length === 0 && group.genres.length > 0) patch.genre = group.genres;
  if (blank(existing.trailer_url) && group.trailerUrl) patch.trailer_url = group.trailerUrl;

  const hasPoster = Object.values(existing.poster ?? {}).some(
    (value) => typeof value === "string" && value.trim() !== "",
  );
  if (!hasPoster && group.posterUrl) patch.poster = { url: group.posterUrl };

  return patch;
}

/** Source-native refs that should permanently point to the same canonical film. */
export function sourceRefsForMovieGroup(group: EbilletMovieGroup): string[] {
  return [...new Set([group.ref, ...group.movieIds.map((id) => `movie-${id}`)])];
}
