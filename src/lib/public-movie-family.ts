export type MovieFamilyCandidate = {
  id: string;
  title: string;
  originalTitle?: string | null;
  year?: number | null;
  genres?: string[] | null;
  runtime?: number | null;
  tmdbId?: number | null;
  screeningCount?: number | null;
};

export type MovieFamily = {
  canonicalId: string;
  memberIds: string[];
};

export type MovieFamilyIndex = {
  families: MovieFamily[];
  canonicalByMember: Map<string, string>;
  membersByCanonical: Map<string, string[]>;
};

const fold = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("da")
    .replace(/&/g, " og ")
    .replace(/[^a-z0-9æøå]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const PRESENTATION_SUFFIXES = [
  /\s+(?:med\s+)?danske?\s+(?:under)?tekster?$/,
  /\s+dk\s+(?:tale|tekst(?:er)?)$/,
  /\s+dansk\s+tale$/,
  /\s+engelsk\s+tale$/,
  /\s+ensk\s+tala$/,
  /\s+org(?:inal)?\s+tale$/,
  /\s+originalversion$/,
  /\s+[23]d$/,
];

/**
 * A deliberately narrow display-title key. It removes only cinema presentation
 * suffixes (language/format), never arbitrary event names or years.
 */
export function publicMovieTitleKey(title: string): string {
  let value = fold(title);
  let previous = "";
  while (value && value !== previous) {
    previous = value;
    for (const suffix of PRESENTATION_SUFFIXES) value = value.replace(suffix, "").trim();
  }
  return value;
}

const validYear = (value: number | null | undefined): number | null => {
  const year = Number(value ?? 0);
  return Number.isInteger(year) && year >= 1888 && year <= 2100 ? year : null;
};

const normalizedGenres = (values: string[] | null | undefined): Set<string> =>
  new Set((values ?? []).map(fold).filter(Boolean));

function genreEvidence(a: MovieFamilyCandidate, b: MovieFamilyCandidate): boolean {
  const left = normalizedGenres(a.genres);
  const right = normalizedGenres(b.genres);
  let shared = 0;
  for (const genre of left) if (right.has(genre)) shared += 1;
  return shared >= 2;
}

function runtimeEvidence(a: MovieFamilyCandidate, b: MovieFamilyCandidate): boolean {
  const ar = Number(a.runtime ?? 0);
  const br = Number(b.runtime ?? 0);
  return ar > 0 && br > 0 && Math.abs(ar - br) <= 5;
}

/**
 * Safe public-only equivalence. No database identities are changed here.
 *
 * Strong cases:
 * - same TMDb id;
 * - same clean title with compatible known years;
 * - same clean title where one year is known and the other is missing;
 * - when both years are missing, title alone is NOT enough: two shared genres
 *   or near-identical runtime is required.
 *
 * Known years more than one year apart are treated as different films. This is
 * what keeps e.g. the 1981 and 2022 "Gummi Tarzan" records separate.
 */
export function canSharePublicMovieFamily(
  a: MovieFamilyCandidate,
  b: MovieFamilyCandidate,
): boolean {
  if (a.id === b.id) return true;
  if (a.tmdbId && b.tmdbId && a.tmdbId === b.tmdbId) return true;

  const aKey = publicMovieTitleKey(a.title);
  const bKey = publicMovieTitleKey(b.title);
  if (!aKey || aKey !== bKey) return false;

  const ay = validYear(a.year);
  const by = validYear(b.year);
  if (ay !== null && by !== null) return Math.abs(ay - by) <= 1;
  if (ay !== null || by !== null) return true;

  return genreEvidence(a, b) || runtimeEvidence(a, b);
}

function score(candidate: MovieFamilyCandidate): [number, number, number, number, string] {
  return [
    candidate.tmdbId ? 1 : 0,
    validYear(candidate.year) !== null ? 1 : 0,
    Number(candidate.runtime ?? 0) > 0 ? 1 : 0,
    Number(candidate.screeningCount ?? 0),
    candidate.id,
  ];
}

function better(a: MovieFamilyCandidate, b: MovieFamilyCandidate): MovieFamilyCandidate {
  const as = score(a);
  const bs = score(b);
  for (let i = 0; i < 4; i++) {
    if (as[i] !== bs[i]) return (as[i] as number) > (bs[i] as number) ? a : b;
  }
  return String(as[4]).localeCompare(String(bs[4])) <= 0 ? a : b;
}

/**
 * Build connected movie families from active public candidates. The comparison
 * is intentionally O(n²): Lanterna currently has hundreds, not millions, of
 * active films, and the conservative pairwise rules are easier to audit.
 */
export function buildPublicMovieFamilies(candidates: MovieFamilyCandidate[]): MovieFamilyIndex {
  const parent = new Map(candidates.map((candidate) => [candidate.id, candidate.id] as const));
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate] as const));

  const find = (id: string): string => {
    const p = parent.get(id) ?? id;
    if (p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };

  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (canSharePublicMovieFamily(candidates[i]!, candidates[j]!)) {
        union(candidates[i]!.id, candidates[j]!.id);
      }
    }
  }

  const groups = new Map<string, MovieFamilyCandidate[]>();
  for (const candidate of candidates) {
    const root = find(candidate.id);
    const group = groups.get(root) ?? [];
    group.push(candidate);
    groups.set(root, group);
  }

  const families: MovieFamily[] = [];
  const canonicalByMember = new Map<string, string>();
  const membersByCanonical = new Map<string, string[]>();

  for (const group of groups.values()) {
    let representative = group[0]!;
    for (const candidate of group.slice(1)) representative = better(representative, candidate);
    const memberIds = group.map((candidate) => candidate.id).sort();
    families.push({ canonicalId: representative.id, memberIds });
    membersByCanonical.set(representative.id, memberIds);
    for (const id of memberIds) canonicalByMember.set(id, representative.id);
  }

  families.sort((a, b) => {
    const am = byId.get(a.canonicalId)!;
    const bm = byId.get(b.canonicalId)!;
    return Number(bm.screeningCount ?? 0) - Number(am.screeningCount ?? 0) ||
      am.title.localeCompare(bm.title, "da");
  });

  return { families, canonicalByMember, membersByCanonical };
}
