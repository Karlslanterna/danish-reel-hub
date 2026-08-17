import { normalizeMovieTitle, validMovieYear } from "./movie-dedup";

export type ContinuityCandidateMovie = {
  id: string;
  title: string;
  originalTitle?: string | null;
  year?: number | null;
  tmdbId?: number | null;
  ebilletBaseId?: number | null;
  ebilletMovieIds?: number[] | null;
};

export function chooseContinuityCandidate(input: {
  incomingTitle: string;
  incomingYear?: number | null;
  currentCanonicalId?: string | null;
  totalSlots: number;
  slotCandidates: string[][];
  candidates: ContinuityCandidateMovie[];
}): { canonicalId: string; evidence: number; requiredEvidence: number } | null {
  const incomingTitle = normalizeMovieTitle(input.incomingTitle);
  if (!incomingTitle || input.totalSlots < 2) return null;
  const incomingYear = validMovieYear(input.incomingYear);
  const byId = new Map(input.candidates.map((movie) => [movie.id, movie]));
  const counts = new Map<string, number>();

  for (const ids of input.slotCandidates) {
    const compatible = [...new Set(ids)]
      .filter((id) => id !== input.currentCanonicalId)
      .map((id) => byId.get(id))
      .filter((movie): movie is ContinuityCandidateMovie => Boolean(movie))
      .filter((movie) =>
        Boolean(movie.tmdbId) || Boolean(movie.ebilletBaseId) ||
        Boolean(movie.ebilletMovieIds?.length) || validMovieYear(movie.year) !== null,
      )
      .filter((movie) =>
        [movie.title, movie.originalTitle]
          .filter((value): value is string => Boolean(value?.trim()))
          .map(normalizeMovieTitle)
          .includes(incomingTitle),
      )
      .filter((movie) => {
        const candidateYear = validMovieYear(movie.year);
        return incomingYear === null || candidateYear === null || incomingYear === candidateYear;
      });
    if (compatible.length !== 1) continue;
    const id = compatible[0]!.id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length !== 1) return null;
  const requiredEvidence = Math.min(3, Math.max(2, Math.ceil(input.totalSlots * 0.1)));
  const [canonicalId, evidence] = ranked[0]!;
  return evidence >= requiredEvidence ? { canonicalId, evidence, requiredEvidence } : null;
}
