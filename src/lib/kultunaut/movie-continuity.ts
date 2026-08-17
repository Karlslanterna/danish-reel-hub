import { normalizeMovieTitle, validMovieYear } from "./movie-dedup";

export type ContinuityCandidateMovie = {
  id: string;
  title: string;
  originalTitle?: string | null;
  genres?: string[] | null;
  year?: number | null;
  runtime?: number | null;
  tmdbId?: number | null;
  ebilletBaseId?: number | null;
  ebilletMovieIds?: number[] | null;
};

const normalizeGenre = (value: string): string =>
  value
    .trim()
    .toLocaleLowerCase("da")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const titleMatches = (incoming: string, movie: ContinuityCandidateMovie): boolean =>
  [movie.title, movie.originalTitle]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(normalizeMovieTitle)
    .includes(incoming);

const isStrongAnchor = (movie: ContinuityCandidateMovie): boolean =>
  Boolean(movie.tmdbId) ||
  Boolean(movie.ebilletBaseId) ||
  Boolean(movie.ebilletMovieIds?.length) ||
  validMovieYear(movie.year) !== null;

function genresMatch(incoming: string[], candidate: string[], incomingYear: number | null): boolean {
  const left = [...new Set(incoming.map(normalizeGenre).filter(Boolean))];
  const right = new Set(candidate.map(normalizeGenre).filter(Boolean));
  // Unknown-year rows need a stronger fingerprint than title alone.
  if (left.length < (incomingYear === null ? 2 : 1)) return false;
  return left.every((genre) => right.has(genre));
}

/**
 * Match a Kultunaut movie to an already-active canonical film only when one
 * strong candidate is uniquely compatible. A title by itself is never enough:
 * unknown-year records must also share at least two genres, and known years may
 * never conflict. Runtime, when present on both sides, must be plausibly close.
 */
export function chooseContinuityCandidate(input: {
  incomingTitle: string;
  incomingYear?: number | null;
  incomingGenres: string[];
  incomingRuntime?: number | null;
  currentCanonicalId?: string | null;
  candidates: ContinuityCandidateMovie[];
}): { canonicalId: string } | null {
  const incomingTitle = normalizeMovieTitle(input.incomingTitle);
  const incomingYear = validMovieYear(input.incomingYear);
  if (!incomingTitle) return null;

  const compatible = input.candidates
    .filter((movie) => movie.id !== input.currentCanonicalId)
    .filter(isStrongAnchor)
    .filter((movie) => titleMatches(incomingTitle, movie))
    .filter((movie) => {
      const candidateYear = validMovieYear(movie.year);
      return incomingYear === null || candidateYear === null || incomingYear === candidateYear;
    })
    .filter((movie) => genresMatch(input.incomingGenres, movie.genres ?? [], incomingYear))
    .filter((movie) => {
      const incomingRuntime = Number(input.incomingRuntime ?? 0);
      const candidateRuntime = Number(movie.runtime ?? 0);
      return (
        incomingRuntime <= 0 ||
        candidateRuntime <= 0 ||
        Math.abs(incomingRuntime - candidateRuntime) <= 5
      );
    });

  return compatible.length === 1 ? { canonicalId: compatible[0]!.id } : null;
}
