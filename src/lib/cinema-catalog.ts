/**
 * Source rows that describe the same physical cinema.
 *
 * Kultunaut remains the canonical public record because it has the strongest
 * location metadata. eBillet rows are retained as source identities so their
 * screenings can be queried and shown on the same public cinema page.
 */
export const CINEMA_ALIAS_TO_CANONICAL = {
  "eb-168": "kn-28463",
  "eb-192": "kn-51903",
  "eb-202": "kn-251004",
  "eb-171": "kn-50143",
  "eb-118": "kn-2037655",
  "eb-159": "kn-891061",
  "eb-177": "kn-891095",
  "eb-178": "kn-2273815",
  "eb-214": "kn-8561",
  "eb-231": "kn-891074",
  "eb-167": "kn-367",
  "eb-218": "kn-9809",
  "eb-179": "kn-5225",
  "eb-235": "kn-16963",
  "eb-201": "kn-133208",
  "eb-122": "kn-321249",
  "eb-234": "kn-891057",
  "eb-210": "kn-341816",
  "eb-197": "kn-2022878",
  "eb-126": "kn-891098",
  "eb-175": "kn-133318",
  "eb-149": "kn-171004",
  "eb-165": "kn-641227",
  "eb-123": "kn-891102",
} as const satisfies Record<string, string>;

const aliasesByCanonical = new Map<string, string[]>();
for (const [alias, canonical] of Object.entries(CINEMA_ALIAS_TO_CANONICAL)) {
  const aliases = aliasesByCanonical.get(canonical) ?? [];
  aliases.push(alias);
  aliasesByCanonical.set(canonical, aliases);
}

export function canonicalCinemaId(id: string): string {
  return CINEMA_ALIAS_TO_CANONICAL[id as keyof typeof CINEMA_ALIAS_TO_CANONICAL] ?? id;
}

/** Expand public cinema ids to every source row that can own screenings. */
export function expandCinemaIds(ids: string[]): string[] {
  const expanded = new Set<string>();
  for (const id of ids) {
    const canonical = canonicalCinemaId(id);
    expanded.add(canonical);
    for (const alias of aliasesByCanonical.get(canonical) ?? []) expanded.add(alias);
  }
  return [...expanded];
}

export type ConsolidatedCinema<T> = T & {
  sourceIds: string[];
  sourceSlugs: string[];
};

/**
 * Collapse known source aliases when the canonical row is present.
 * Unknown or unmatched venues remain untouched; fuzzy matching is deliberately
 * kept out of the public request path.
 */
export function consolidatePublicCinemas<T extends { id: string; slug: string }>(
  cinemas: T[],
): ConsolidatedCinema<T>[] {
  const ids = new Set(cinemas.map((cinema) => cinema.id));
  const groups = new Map<string, T[]>();

  for (const cinema of cinemas) {
    const candidate = canonicalCinemaId(cinema.id);
    const canonical = candidate !== cinema.id && !ids.has(candidate) ? cinema.id : candidate;
    const group = groups.get(canonical) ?? [];
    group.push(cinema);
    groups.set(canonical, group);
  }

  return [...groups.entries()].map(([canonicalId, members]) => {
    const canonical = members.find((cinema) => cinema.id === canonicalId) ?? members[0]!;
    return {
      ...canonical,
      sourceIds: [...new Set(members.map((cinema) => cinema.id))],
      sourceSlugs: [...new Set(members.map((cinema) => cinema.slug))],
    };
  });
}

export function remapScreeningCinemaIds<T extends { cinema_id: string }>(rows: T[]): T[] {
  return rows.map((row) => ({ ...row, cinema_id: canonicalCinemaId(row.cinema_id) }));
}
