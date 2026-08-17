/**
 * Matching an eBillet organizer to an existing (usually Kultunaut) cinema.
 *
 * The naive "same name + same city string" rule fails in practice because:
 *  - Kultunaut stores cities with a postcode prefix ("7000 Fredericia") while
 *    eBillet stores "Fredericia" / "DK-7000",
 *  - eBillet often drops the city from the venue name ("Kosmorama" in
 *    Haderslev vs Kultunaut's "Kosmorama Haderslev"),
 *  - several unrelated venues share a bare name ("Kosmorama", "Grafen").
 *
 * Matching is deliberately conservative: a deterministic rule must yield
 * exactly one unclaimed cinema. Ambiguity is never resolved by array order.
 */

import { baseCityOf } from "@/lib/city-slug";

export const slugifyName = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[æø]/g, (c) => (c === "æ" ? "ae" : "oe"))
    .replace(/å/g, "aa")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";

const stripYearSuffix = (title: string): string =>
  title.replace(/\s*[([]\s*(?:19|20)\d{2}\s*[)\]]\s*$/u, "").trim();

export const normKey = (value: string): string => slugifyName(stripYearSuffix(value));

/** "DK-7000 Fredericia" / "7000 Fredericia N" / "Fredericia" -> "fredericia" */
export const cityKey = (value: string | null | undefined): string => {
  if (!value) return "";
  const cleaned = value.replace(/^\s*(?:DK[-\s]?)?\d{3,4}\b/iu, " ").trim();
  return normKey(baseCityOf(cleaned) || cleaned);
};

export type MatchCinema = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  ebillet_organizer_id: number | null;
};

export type MatchOrganizer = {
  id: number;
  name: string;
  city?: string | null;
};

/** True when the two city strings clearly denote different towns. */
const cityConflict = (a: string, b: string) => a !== "" && b !== "" && a !== b;

/**
 * Pick the existing cinema an organizer belongs to, or null when there is no
 * single safe match. Never returns a cinema already claimed by a different
 * organizer and never chooses arbitrarily among multiple matching rows.
 */
export function matchCinema(
  organizer: MatchOrganizer,
  cinemas: MatchCinema[],
): MatchCinema | null {
  const claimed = cinemas.filter((c) => c.ebillet_organizer_id === organizer.id);
  if (claimed.length === 1) return claimed[0]!;
  if (claimed.length > 1) return null;

  const oName = normKey(organizer.name);
  const oCity = cityKey(organizer.city);
  const oNameCity = oCity ? normKey(`${organizer.name} ${organizer.city}`) : oName;

  const free = cinemas.filter((c) => c.ebillet_organizer_id === null);

  const rules: Array<(c: MatchCinema) => boolean> = [
    // 1. identical name in the same town
    (c) => normKey(c.name) === oName && !cityConflict(cityKey(c.city), oCity),
    // 2. Kultunaut spells out the town: "Kosmorama Haderslev" == "Kosmorama" @ Haderslev
    (c) => oCity !== "" && normKey(c.name) === oNameCity,
    // 3. the reverse: eBillet spells out the town
    (c) =>
      cityKey(c.city) !== "" &&
      normKey(`${c.name} ${c.city}`) === oName &&
      !cityConflict(cityKey(c.city), oCity),
    // 4. same slug in the same town (name punctuation differences)
    (c) => c.slug === slugifyName(organizer.name) && !cityConflict(cityKey(c.city), oCity),
  ];

  for (const rule of rules) {
    const hits = free.filter(rule);
    if (hits.length === 1) return hits[0]!;
    // If a rule that should be deterministic is ambiguous, weaker rules may
    // not be used to break the tie. Leave the organizer unresolved instead.
    if (hits.length > 1) return null;
  }
  return null;
}

/**
 * A slug that is guaranteed free among `cinemas` (the DB has a unique index on
 * cinemas.slug, so a collision otherwise aborts the whole organizer sync).
 */
export function uniqueCinemaSlug(
  organizer: MatchOrganizer,
  cinemas: MatchCinema[],
  excludeId?: string,
): string {
  const taken = new Set(cinemas.filter((c) => c.id !== excludeId).map((c) => c.slug));
  const base = slugifyName(organizer.name);
  if (!taken.has(base)) return base;

  const city = organizer.city
    ? slugifyName(organizer.city.replace(/^\s*(?:DK[-\s]?)?\d{3,4}\b/iu, ""))
    : "";
  const withCity = city ? `${base}-${city}` : "";
  if (withCity && !taken.has(withCity)) return withCity;

  const withId = `${base}-${organizer.id}`;
  if (!taken.has(withId)) return withId;

  for (let n = 2; ; n++) {
    const candidate = `${withId}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
