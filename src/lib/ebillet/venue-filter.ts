/**
 * Venue classification for eBillet organizers.
 *
 * eBillet is used by more than cinemas — museums, planetariums, theatres and
 * other attractions also sell tickets through it. Only actual cinemas (or
 * cinema venues) may enter Lanterna as biografer, so every organizer is
 * classified here BEFORE discovery activates it or the sync creates a cinema.
 *
 * Extending the filter: add to EXCLUDED_ORGANIZER_IDS (stable, preferred when
 * the id is known) or NON_CINEMA_NAME_PATTERNS. No frontend change needed.
 */

/** Stable eBillet organizer ids that must never become cinemas. */
export const EXCLUDED_ORGANIZER_IDS: ReadonlySet<number> = new Set<number>([]);

/**
 * Name/word patterns that identify a non-cinema venue. Matched against the
 * organizer name (accent- and case-insensitive, word-boundary aware).
 */
export const NON_CINEMA_NAME_PATTERNS: readonly RegExp[] = [
  /\bmuseum(er|et|s)?\b/,
  /\bmuseet\b/,
  /\bplanetarium\b/,
  /\bfort\b/,
  /\bkalk\b/,
  /\bakvarium\b/,
  /\bzoo\b/,
  /\bteater|teatret\b/,
  /\bkoncerthus/,
  /\bbibliotek/,
  /\bforsamlingshus/,
  /\bkirke\b/,
  /\bidraetsanlaeg|\bstadion\b/,
  /\bslot(tet)?\b/,
  /\bvidenscenter|\bscience\s?center\b/,
];

/** Explicit allow-list: venues that match a pattern but ARE cinemas. */
export const ALLOWED_ORGANIZER_NAMES: readonly string[] = [
  "fortbio",
  "museumsbio",
  "teaterbio",
  "teaterbiografen",
];

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "oe")
    .replace(/å/g, "aa")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type VenueClassification = {
  isCinema: boolean;
  /** Human-readable reason when excluded (Danish, shown in admin). */
  reason: string | null;
};

/**
 * Decide whether an eBillet organizer should be imported as a cinema.
 */
export function classifyOrganizer(input: {
  id: number;
  name: string;
}): VenueClassification {
  if (EXCLUDED_ORGANIZER_IDS.has(input.id)) {
    return { isCinema: false, reason: "Ekskluderet organizer-id (ikke en biograf)" };
  }

  const name = normalize(input.name);

  if (ALLOWED_ORGANIZER_NAMES.some((allowed) => name.includes(normalize(allowed)))) {
    return { isCinema: true, reason: null };
  }

  // "bio"/"biograf"/"cinema"/"kino" in the name is a strong cinema signal.
  if (/\b(biograf(en|er)?|bio|biografen|cinema(s|xx?)?|kino|cinemaxx|nordisk film)\b/.test(name)) {
    return { isCinema: true, reason: null };
  }

  const hit = NON_CINEMA_NAME_PATTERNS.find((re) => re.test(name));
  if (hit) {
    return { isCinema: false, reason: `Ikke-biograf spillested (matcher ${hit.source})` };
  }

  return { isCinema: true, reason: null };
}

export function isCinemaOrganizer(input: { id: number; name: string }): boolean {
  return classifyOrganizer(input).isCinema;
}
