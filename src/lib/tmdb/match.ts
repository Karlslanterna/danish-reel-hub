/**
 * Conservative title+year matching between Kultunaut films and TMDb results.
 * Anything that is not a near-certain match is skipped and logged; the import
 * never fails because of a bad or missing match.
 */

/** Strip a trailing year in brackets, e.g. "Michael (2025)" -> "Michael". */
export const stripYearSuffix = (title: string): string =>
  title.replace(/\s*[([]\s*(?:19|20)\d{2}\s*[)\]]\s*$/u, "").trim();

/** Screening-format / event noise that Kultunaut appends to titles. */
const NOISE =
  /\b(2d|3d|imax|4dx|ov|originalversion|dansk\s*tale|m\/?\s*dansk\s*tale|med\s*dansk\s*tale|dubbet|eng\.?\s*tale|babybio|seniorbio|filmklub|forpremiere|premiere|sing[\s-]?along|dolby|atmos|kortfilm|genudsendelse|reprise)\b/gi;

export function normalizeTitle(raw: string): string {
  return stripYearSuffix(raw)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[æ]/g, "ae")
    .replace(/[ø]/g, "oe")
    .replace(/[å]/g, "aa")
    .replace(NOISE, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type MatchCandidate = {
  id: number;
  title: string;
  original_title: string;
  release_date: string | null;
  vote_count: number;
  popularity: number;
};

export type MatchOutcome =
  | { matched: true; id: number; confidence: number }
  | { matched: false; reason: string };

const yearOf = (releaseDate: string | null): number | null => {
  const y = Number((releaseDate ?? "").slice(0, 4));
  return Number.isFinite(y) && y > 1880 ? y : null;
};

/**
 * Score a single candidate 0..1. Only exact normalized title equality can
 * reach the auto-accept threshold — no fuzzy string distance at launch.
 */
function score(feedTitle: string, feedYear: number | null, c: MatchCandidate): number {
  const target = normalizeTitle(feedTitle);
  if (!target) return 0;
  const titles = [normalizeTitle(c.title), normalizeTitle(c.original_title)];
  const titleExact = titles.includes(target);
  if (!titleExact) return 0;

  let s = 0.8; // exact normalized title
  const candidateYear = yearOf(c.release_date);
  if (feedYear && candidateYear) {
    const delta = Math.abs(feedYear - candidateYear);
    if (delta === 0) s += 0.2;
    else if (delta === 1) s += 0.12;
    else return 0; // same title but clearly a different film (remake etc.)
  } else {
    s += 0.05; // no year to verify against — stays below auto-accept alone
  }
  return Math.min(1, s);
}

const ACCEPT = 0.92;
const RUNNER_UP_GAP = 0.1;

export function pickMatch(
  feedTitle: string,
  feedYear: number | null,
  candidates: MatchCandidate[],
): MatchOutcome {
  if (candidates.length === 0) return { matched: false, reason: "ingen TMDb-resultater" };

  const scored = candidates
    .map((c) => ({ c, s: score(feedTitle, feedYear, c) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.c.vote_count - a.c.vote_count);

  if (scored.length === 0) return { matched: false, reason: "ingen titelmatch" };

  const best = scored[0];
  const runnerUp = scored[1];

  if (best.s < ACCEPT) {
    return { matched: false, reason: `lav sikkerhed (${best.s.toFixed(2)})` };
  }
  if (runnerUp && best.s - runnerUp.s < RUNNER_UP_GAP) {
    return { matched: false, reason: "flere lige gode kandidater" };
  }
  return { matched: true, id: best.c.id, confidence: best.s };
}
