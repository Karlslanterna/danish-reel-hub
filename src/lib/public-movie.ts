const fold = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("da")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Lanterna is a film finder, not a generic cinema event calendar. Keep source
 * rows intact in the database, but do not expose obvious placeholders,
 * closures, ticket/food helpers or programme shells as if they were films.
 *
 * Rules intentionally match only strong, recognisable prefixes/exact shells;
 * a real film that happens to be shown at a festival or special event remains
 * public.
 */
const NON_FILM_PATTERNS: RegExp[] = [
  /^bestil bord(?:\b| og)/,
  /^specialarrangement\b/,
  /^særarrangement\b/,
  /^saerarrangement\b/,
  /^særvisning(?:\b|$)/,
  /^saervisning(?:\b|$)/,
  /^særforestilling(?:\b|$)/,
  /^saerforestilling(?:\b|$)/,
  /^lukket(?:\b|$)/,
  /^ferielukket(?:\b|$)/,
  /^film titel ikke valgt(?:\b|$)/,
  /^lokalt arrangement(?:\b|$)/,
  /^pressevisning(?:\b|$)/,
  /^børnebiffen(?:\b|$)/,
  /^bornebiffen(?:\b|$)/,
  /^bamsebio(?:\b|$)/,
  /^børnefilmklub(?:\b|$)/,
  /^bornefilmklub(?:\b|$)/,
  /^filmpakke\s+\d+\b/,
  /^pyjamas bio(?:\b|$)/,
  /^seniorbio(?:\b|$)/,
  /^erindringsbio(?:\b|$)/,
  /^bfk\b/,
  /^off\s*:\s*/,
  /^off\s*-\s*børnebiffen\b/,
  /^off\s*-\s*bornebiffen\b/,
  /^opera\s*:/,
  /^ballet\s*:/,
  /^teater\s*:/,
  /^koncert\s*:/,
  /^foyerkoncert\b/,
  /^foredrag(?:\b|\s+og\s+debat)/,
  /^stand[ -]?up\b/,
  /^musik banko\b/,
  /^dfi forkørsel\b/,
  /^dfi forkoersel\b/,
  /^5 kurdiske film$/,
  /^fejr fremtidens filmoplevelser sammen med os!?$/,
];

export function isPublicMovieTitle(title: string | null | undefined): boolean {
  const value = fold(title ?? "");
  if (!value) return false;
  return !NON_FILM_PATTERNS.some((pattern) => pattern.test(value));
}

const GENRE_ALIASES: Record<string, string | null> = {
  "andre film": null,
  romance: "Romantik",
  romantik: "Romantik",
  horror: "Gyser",
  gyser: "Gyser",
  adventure: "Eventyr",
  eventyr: "Eventyr",
  history: "Historie",
  historie: "Historie",
  tegnefilm: "Animation",
  animation: "Animation",
  spændingsfilm: "Thriller",
  spaendingsfilm: "Thriller",
  thriller: "Thriller",
  "science fiction": "Science fiction",
  "sci fi": "Science fiction",
  "sci-fi": "Science fiction",
};

/** Keep the genre filter small, Danish and free of source-category noise. */
export function normalizePublicGenres(values: string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of values ?? []) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = fold(trimmed);
    const mapped = Object.prototype.hasOwnProperty.call(GENRE_ALIASES, key)
      ? GENRE_ALIASES[key]
      : trimmed;
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out;
}
