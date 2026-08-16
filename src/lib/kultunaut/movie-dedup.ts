export type MovieIdentity = {
  title: string;
  year: number | null;
  originalTitle?: string | null;
};

const stripYearSuffix = (title: string): string =>
  title.replace(/\s*[\(\[]\s*(?:19|20)\d{2}\s*[\)\]]\s*$/u, "").trim();

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
 * A title alone is not a safe identity for a film. Prefer title + year;
 * only fall back to title-only when both records have no year.
 */
export const movieIdentityKey = (movie: MovieIdentity): string => {
  const title = normalizeMovieTitle(movie.title);
  if (movie.year != null && Number.isFinite(movie.year)) return `${title}|${movie.year}`;
  return `${title}|unknown-year`;
};

export function sameMovieIdentity(a: MovieIdentity, b: MovieIdentity): boolean {
  if (movieIdentityKey(a) === movieIdentityKey(b)) return true;
  // A yearless source record may safely match a dated record only when the
  // yearless record has no original-title signal that distinguishes it.
  if (a.year == null && b.year == null) return normalizeMovieTitle(a.title) === normalizeMovieTitle(b.title);
  return false;
}
