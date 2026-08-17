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

/**
 * Film identity is title + year. A missing year never gets merged with a
 * dated record: that is safer than collapsing two distinct films.
 */
export const movieIdentityKey = (movie: MovieIdentity): string => {
  const title = normalizeMovieTitle(movie.title);
  const year = movie.year != null && Number.isFinite(movie.year) ? movie.year : "unknown";
  return `${title}|${year}`;
};

export function sameMovieIdentity(a: MovieIdentity, b: MovieIdentity): boolean {
  return movieIdentityKey(a) === movieIdentityKey(b);
}
