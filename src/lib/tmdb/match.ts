/**
 * Conservative title+year matching between Kultunaut films and TMDb results.
 * Anything that is not a near-certain match is skipped and logged; the import
 * never fails because of a bad or missing match.
 */

import { publicMovieDisplayTitle } from "@/lib/public-movie";

/** Strip a trailing year in brackets, e.g. "Michael (2025)" -> "Michael". */
export const stripYearSuffix = (title: string): string =>
  title.replace(/\s*[([]\s*(?:19|20)\d{2}\s*[)\]]\s*$/u, "").trim();

export const titleYear = (title: string): number | null => {
  const value = title.match(/\s*[([]\s*((?:19|20)\d{2})\s*[)\]]\s*$/u)?.[1];
  const year = Number(value ?? 0);
  return year > 1880 ? year : null;
};

/** eBillet's programme year is not a film release year; an explicit title year is. */
export function sourceYearForMatch(movie: {
  id: string;
  title: string;
  year: number | null;
}): number | null {
  const explicit = titleYear(movie.title);
  if (explicit) return explicit;
  if (movie.id.startsWith("eb-")) return null;
  return movie.year && movie.year > 1880 ? movie.year : null;
}

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
  { matched: true; id: number; confidence: number } | { matched: false; reason: string };

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

  // With no trustworthy source year, accept only one exact title candidate
  // with a real TMDb release date and at least a minimal popularity signal.
  // Multiple remakes remain ambiguous and are still rejected.
  if (
    !feedYear &&
    scored.length === 1 &&
    yearOf(best.c.release_date) &&
    (best.c.vote_count > 0 || best.c.popularity >= 1)
  ) {
    return { matched: true, id: best.c.id, confidence: 0.93 };
  }

  // A yearless programme title can still be unambiguous when one exact-title
  // film is overwhelmingly better established than every same-title remake.
  // Keep the bar deliberately high so a new or obscure release is never
  // guessed from popularity alone.
  if (
    !feedYear &&
    runnerUp &&
    best.c.vote_count >= 100 &&
    best.c.vote_count >= Math.max(100, runnerUp.c.vote_count * 5)
  ) {
    return { matched: true, id: best.c.id, confidence: 0.92 };
  }

  if (best.s < ACCEPT) {
    return { matched: false, reason: `lav sikkerhed (${best.s.toFixed(2)})` };
  }
  if (runnerUp && best.s - runnerUp.s < RUNNER_UP_GAP) {
    return { matched: false, reason: "flere lige gode kandidater" };
  }
  return { matched: true, id: best.c.id, confidence: best.s };
}

/**
 * Listings that are not films: children's programmes, themed screenings,
 * lectures, concert playbacks and similar. TMDb has no record of these, so
 * searching for them only burns API calls and produces noise in the log.
 */
const NON_FILM_PATTERNS: RegExp[] = [
  /børnebiff/i,
  /biffen/i,
  /^filmklub\b/i,
  /\bforedrag\b/i,
  /\bdebat\b/i,
  /\bq\s*&\s*a\b/i,
  /\bworkshop\b/i,
  /\bpitchblack playback\b/i,
  /\blive viewing\b/i,
  /\blive\s*(?:stream|transmission|optagelse)\b/i,
  /\bkortfilm\b/i,
  /\bshort films?\b/i,
  /\bhygge\b/i,
  /\bsæson\b/i,
  /\bmatiné\b/i,
  /\bopera\b/i,
  /\bballet\b/i,
  /\bkoncert\b/i,
  /\bfestival\b/i,
  /\bmarathon\b/i,
  /\bsidste dag\b/i,
  /\b\d{1,2}\s*-\s*\d{1,2}\s*år\b/i,
  /\bfra \d{1,2} år\b/i,
];

export function isNonFilmEvent(title: string): boolean {
  return NON_FILM_PATTERNS.some((re) => re.test(title));
}

/**
 * Danish release titles that TMDb only knows under the original title.
 * Keys are normalized titles, values are extra search queries.
 */
const DANISH_ALIASES: Record<string, string[]> = {
  hadet: ["La Haine"],
  vaiana: ["Moana"],
  "vaiana 2": ["Moana 2"],
  "pigen holly": ["Breakfast at Tiffany's"],
  "de utrolige": ["The Incredibles"],
  istid: ["Ice Age"],
  syng: ["Sing"],
  "grisen babe": ["Babe"],
  "troldmandens laerling": ["The Sorcerer's Apprentice"],
  biler: ["Cars"],
  "et vildt liv": ["The Wild Robot"],
  "flugten fra hoensegaarden": ["Chicken Run"],
  shrek: ["Shrek"],
  "skoenheden og udyret": ["Beauty and the Beast"],
  "den lille havfrue": ["The Little Mermaid"],
  "paw patrol dino filmen": ["PAW Patrol: The Dino Movie", "PAW Patrol"],
  "skolen med magiske dyr filmen": ["The School of Magical Animals"],
  "der var engang i amerika": ["Once Upon a Time in America"],
  "farven lilla": ["The Color Purple"],
  "pandoras aeske": ["Pandora's Box"],
};

/**
 * Ordered, de-duplicated list of search queries for one film: the feed title,
 * then any bracketed/dash original title, the DB original title, and finally a
 * known Danish alias. Matching itself stays as strict as before.
 */
export function searchQueries(title: string, originalTitle?: string | null): string[] {
  const out: string[] = [];
  const push = (v?: string | null) => {
    const s = (v ?? "").trim();
    if (!s) return;
    if (!out.some((x) => normalizeTitle(x) === normalizeTitle(s))) out.push(s);
  };

  const base = stripYearSuffix(title);
  const displayTitle = publicMovieDisplayTitle(base);
  push(displayTitle);
  push(base);

  // "Pigen Holly (Breakfast at Tiffany's)" -> "Breakfast at Tiffany's"
  const paren = base.match(/\(([^)]{2,})\)\s*$/u);
  if (paren && !/^(?:19|20)\d{2}$/.test(paren[1].trim())) push(paren[1]);

  // Split a bilingual title only when the two halves are a known alias pair.
  // Arbitrary dash splitting is unsafe: programme labels such as
  // "Viva la Revolución" can otherwise make unrelated films share a match.
  const dash = base.split(/\s+[-–—]\s+/u);
  if (dash.length === 2) {
    const aliases = DANISH_ALIASES[normalizeTitle(dash[0])] ?? [];
    if (aliases.some((alias) => normalizeTitle(alias) === normalizeTitle(dash[1]))) {
      dash.forEach(push);
    }
  }

  push(originalTitle);

  for (const key of [normalizeTitle(displayTitle), normalizeTitle(base)]) {
    for (const q of DANISH_ALIASES[key] ?? []) push(q);
  }

  return out;
}
