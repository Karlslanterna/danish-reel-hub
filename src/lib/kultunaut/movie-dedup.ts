export type MovieIdentity = {
  title: string;
  year: number | null;
  originalTitle?: string | null;
};

const stripYearSuffix = (title: string): string =>
  title.replace(/\s*(?:\(|\[)\s*(?:19|20)\d{2}\s*(?:\)|\])\s*$/u, "").trim();

export const normalizeMovieTitle = (value: string): string =>
  stripYearSuffix(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[æø]/g, (c) => (c === "æ" ? "ae" : "oe"))
    .replace(/å/g, "aa")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const validMovieYear = (year: number | null | undefined): number | null =>
  typeof year === "number" && Number.isFinite(year) && year >= 1888 && year <= 2200 ? year : null;

/**
 * General comparison identity: normalized title + known year. Missing/zero
 * years stay distinct from dated records.
 */
export const movieIdentityKey = (movie: MovieIdentity): string => {
  const title = normalizeMovieTitle(movie.title);
  return `${title}|${validMovieYear(movie.year) ?? "unknown"}`;
};

/**
 * Import grouping is stricter than general comparison: two undated Kultunaut
 * records are not automatically the same film merely because their titles
 * match. The stable source id keeps them separate until better evidence exists.
 */
export const kultunautMovieGroupKey = (
  movie: MovieIdentity,
  externalId: string,
): string => {
  const title = normalizeMovieTitle(movie.title);
  const year = validMovieYear(movie.year);
  return year === null ? `${title}|source:${externalId}` : `${title}|${year}`;
};

export function sameMovieIdentity(a: MovieIdentity, b: MovieIdentity): boolean {
  return movieIdentityKey(a) === movieIdentityKey(b);
}
