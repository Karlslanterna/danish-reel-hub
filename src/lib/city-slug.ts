// Canonical city slug helpers.
//
// Kultunaut stores city strings like "2200 København N". For URLs we want a
// short, ASCII, SEO-friendly slug: /koebenhavn, /aarhus, /aalborg.

export const stripPostcode = (s: string) => s.replace(/^\s*\d{3,4}\s+/u, "").trim();

/** "2200 København N" -> "København N" */
export const displayCityOf = (s: string) => stripPostcode(s);

const DISTRICT_CITY_RE = /^(København|Odense|Aarhus|Aalborg|Randers)\s+[A-ZÆØÅ]{1,3}\.?$/u;

/** "2200 København N" -> "København" without merging towns such as Nykøbing F/M. */
export const baseCityOf = (s: string) => {
  const city = stripPostcode(s);
  return city.replace(DISTRICT_CITY_RE, "$1").trim();
};

export function slugifyCity(name: string): string {
  return stripPostcode(name)
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "oe")
    .replace(/å/g, "aa")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "u")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Slug for the *base* city (all postcode areas of a city share one slug). */
export const citySlug = (rawCity: string) => slugifyCity(baseCityOf(rawCity));

/** Top-level paths that can never be a city slug. */
export const RESERVED_CITY_SLUGS = new Set([
  "film",
  "biograf",
  "by",
  "auth",
  "admin",
  "api",
  "mcp",
  "reset-password",
  "sitemap.xml",
  "robots.txt",
  "favicon.svg",
  "logo.svg",
  "og-image.jpg",
  "manifest.webmanifest",
  "assets",
]);

/**
 * Accepts both the new ASCII slug ("koebenhavn") and the legacy lowercase
 * forms ("københavn", "københavn n") so old links keep resolving.
 */
export function cityMatchesSlug(rawCity: string, slug: string): boolean {
  const s = slug.toLowerCase();
  return (
    citySlug(rawCity) === s ||
    slugifyCity(displayCityOf(rawCity)) === s ||
    displayCityOf(rawCity).toLowerCase() === s ||
    baseCityOf(rawCity).toLowerCase() === s
  );
}

export type CityOption = { name: string; slug: string; count: number };

/** Distinct base cities across a cinema list, alphabetically sorted. */
export function cityOptionsFrom(cinemas: Array<{ city: string }>): CityOption[] {
  const map = new Map<string, CityOption>();
  for (const c of cinemas) {
    const name = baseCityOf(c.city);
    if (!name) continue;
    const slug = citySlug(c.city);
    const prev = map.get(slug);
    if (prev) prev.count += 1;
    else map.set(slug, { name, slug, count: 1 });
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "da"));
}
