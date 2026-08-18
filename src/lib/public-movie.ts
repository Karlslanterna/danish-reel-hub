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
  /^bamsebio(?:\b|$)/,
  /^børnefilmklub(?:\b|$)/,
  /^bornefilmklub(?:\b|$)/,
  /^filmpakke\s+\d+\b/,
  /^pyjamas bio(?:\b|$)/,
  /^seniorbio(?:\b|$)/,
  /^erindringsbio(?:\b|$)/,
  /^bfk\b/,
  /^hadsten bio filmklub\b/,
  /^doktrin:\s*afgangspremiere\b/,
  /^harry potter 25ars jubilæum\s*[-–—]\s*de fire (?:første|sidste) film$/,
  /^off 2026\s*\(blok\s*\d+\)/,
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
  /^ampas$/,
  /\bdebataften$/,
  /^fejr fremtidens filmoplevelser sammen med os!?$/,
];

export function isPublicMovieTitle(title: string | null | undefined): boolean {
  const value = fold(title ?? "");
  if (!value) return false;
  return !NON_FILM_PATTERNS.some((pattern) => pattern.test(value));
}

const PROGRAMME_SUFFIX =
  /\s*[-–—]\s*(?=(?:event\b|late\s+night\b|fright\s+night\b|h\.?\s*bio\b|musikfilm\b|musik\s+i\s+mørket\b|havet\b|klassikere\b|filmuniversitetet\b|events?\b|arabiske\s+stemmer\b|monstrene\b|sergej\s+paradjanov\b|sarah\s+maldoror\b|carla\s+sim[oó]n\b|alexander\s+payne\b|hitchcock(?:-hits)?\b|tupac\s+shakur\b|venedig-vindere\b|udflugt\s+på\s+landet\b|strikkebio\b|psych-out\b|anime\b|lang\s*\(som\)\s+søndag\b|film,\s*tapas\b|lejre\s+klimauge\b|hvalsø\s+bio\b|mørkekammerater\b|viva\s+la\s+revoluci[oó]n\b))/iu;

const LANGUAGE_SUFFIX =
  /\s*[-–—]?\s*(?:(?:med\s+)?(?:dansk|dk|engelsk|eng|ensk|original|org)\s+(?:tale|tala|tekst|undertekster)|med\s+danske?\s+undertekster|danske?\s+undertekster|tekstet|dubbet)\s*$/iu;

const PRESENTATION_SUFFIX = /\s*[-–—]?\s*(?:CI|CIN)(?:\.?\s*præs\.?)?\s*$/iu;

/** Remove source-specific programme labels from the public film title only. */
export function publicMovieDisplayTitle(title: string): string {
  let value = title.replace(/^MSIC\s+\d{2}-\d{2}:\s*/iu, "").trim();
  const suffix = value.match(PROGRAMME_SUFFIX);
  if (suffix?.index && suffix.index > 0) value = value.slice(0, suffix.index).trim();
  return value
    .replace(/\s*[-–—]?\s*\(\d{1,2}\/\d{1,2}\s+sidste\s+dag\)\s*$/iu, "")
    .replace(/\s*\(vises\s+m\.?\s*(?:dk\.?|danske?)\s+tekster?\)\s*$/iu, "")
    .replace(/\s{2,}[BCGN]\s*$/u, "")
    .replace(LANGUAGE_SUFFIX, "")
    .replace(PRESENTATION_SUFFIX, "")
    .trim();
}

/**
 * Identity-only title normalization. A year or screening-language suffix may
 * distinguish source records without making them different films. Keep those
 * qualifiers available in the stored/display title, but exclude them from the
 * duplicate key used at the public boundary.
 */
export function publicMovieIdentityTitle(title: string): string {
  return publicMovieDisplayTitle(title)
    .replace(/\s*[([]\s*(?:19|20)\d{2}\s*[)\]]\s*$/u, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("da")
    .replace(/&/g, " and ")
    .replace(/\b(?:and|og)\b/gu, " og ")
    .replace(/[^a-z0-9æøå]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * eBillet's `openingDate` describes this booking programme, not necessarily the
 * film's original release (a 1986 classic may therefore say 2026). Do not show
 * that value as a production year unless TMDb or an explicit release date has
 * verified it.
 */
export function resolvePublicMovieYear(input: {
  id: string;
  title?: string | null;
  source?: string | null;
  year?: number | null;
  releaseDate?: string | null;
  tmdbId?: number | null;
}): number {
  const releaseYear = Number.parseInt((input.releaseDate ?? "").slice(0, 4), 10);
  if (Number.isFinite(releaseYear) && releaseYear > 1880) return releaseYear;
  const titleYear = Number(
    (input.title ?? "").match(/\s*[([]\s*((?:19|20)\d{2})\s*[)\]]\s*$/u)?.[1] ?? 0,
  );
  if (titleYear > 1880) return titleYear;
  const isEbillet = input.source === "ebillet" || input.id.startsWith("eb-");
  if (isEbillet && !input.tmdbId) return 0;
  return Number(input.year ?? 0) || 0;
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

type PosterBearingMovie = {
  title: string;
  tmdbId?: number | null;
  posterSource?: "tmdb" | "source" | "programme" | null;
  poster: { url?: string; alt?: string; fit?: "cover" | "contain" };
};

export const BORNEBIFFEN_POSTER_URL = "/posters/bornebiffen-cinemateket.png";

const isBornebiffenTitle = (title: string): boolean =>
  /^(?:sommer)?(?:børnebiffen|bornebiffen)(?:\b|$)/u.test(fold(title));

/**
 * Some source feeds reuse a programme graphic as the poster for many unrelated
 * films. Keep an image when the rows clearly represent the same film, but fall
 * back to Lanterna's neutral placeholder when one source URL spans titles.
 */
export function suppressCollidingSourcePosters<T extends PosterBearingMovie>(movies: T[]): T[] {
  const byUrl = new Map<string, T[]>();
  for (const movie of movies) {
    const url = movie.posterSource === "source" ? movie.poster.url?.trim() : undefined;
    if (!url) continue;
    const group = byUrl.get(url) ?? [];
    group.push(movie);
    byUrl.set(url, group);
  }

  const colliding = new Set<string>();
  for (const [url, group] of byUrl) {
    const titles = new Set(group.map((movie) => fold(movie.title)));
    const tmdbIds = new Set(
      group.map((movie) => movie.tmdbId).filter((id): id is number => Boolean(id)),
    );
    const allShareTmdbIdentity = tmdbIds.size === 1 && group.every((movie) => movie.tmdbId);
    if (titles.size > 1 && !allShareTmdbIdentity) colliding.add(url);
  }

  if (colliding.size === 0) return movies;
  return movies.map((movie) =>
    movie.poster.url && colliding.has(movie.poster.url)
      ? { ...movie, poster: { ...movie.poster, url: undefined } }
      : movie,
  );
}

/**
 * Apply safe, local artwork only after ambiguous source posters are removed.
 * Børnebiffen packages legitimately share one programme identity, while an
 * eBillet image shared with an unrelated film must still be rejected first.
 */
export function preparePublicMoviePosters<T extends PosterBearingMovie>(movies: T[]): T[] {
  return suppressCollidingSourcePosters(movies).map((movie) => {
    if (movie.poster.url?.trim() || !isBornebiffenTitle(movie.title)) return movie;
    return {
      ...movie,
      poster: {
        ...movie.poster,
        url: BORNEBIFFEN_POSTER_URL,
        alt: movie.poster.alt ?? "Cinemateket – Det Danske Filminstitut",
        fit: "contain",
      },
      posterSource: "programme",
    };
  });
}
