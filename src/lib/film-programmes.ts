import type { ShowtimeTags } from "@/lib/showtime-tags";

export type FilmProgrammeTag = "Filmporten" | "Biografklub Danmark";

export type FilmProgramme = {
  tag: FilmProgrammeTag;
  season: string;
  sourceUrl: string;
  reviewedAt: string;
  reviewDueAt: string;
  titles: readonly string[];
};

/**
 * Curated from the programme owners, not inferred from free text in a feed.
 * Keep the dated review metadata visible in admin so a new season cannot pass
 * unnoticed.
 */
export const FILM_PROGRAMMES: readonly FilmProgramme[] = [
  {
    tag: "Filmporten",
    season: "2026/27",
    sourceUrl: "https://filmporten.dk/vores-film/",
    reviewedAt: "2026-08-18",
    reviewDueAt: "2026-12-01",
    titles: [
      "The Invite",
      "Primavera",
      "Digger",
      "En farlig affære",
      "Gule breve",
      "The Beloved",
      "Fjord",
    ],
  },
  {
    tag: "Biografklub Danmark",
    season: "2026/27",
    sourceUrl: "https://www.biografklubdanmark.dk/film",
    reviewedAt: "2026-08-18",
    reviewDueAt: "2027-06-30",
    titles: [
      "Nøjsomheden",
      "Dobbeltfejl",
      "Fornuft og følelse",
      "Wild Horse Nine",
      "Hvad stiller vi op med far?",
      "Kvinde Ukendt",
      "Vand til blomster",
      "Drengestreger",
      "Amrum",
      "Gæsten",
    ],
  },
] as const;

const normalizeTitle = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("da")
    .replace(/\s*\((?:19|20)\d{2}\)\s*$/u, "")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9æøå]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();

const titleSets = new Map(
  FILM_PROGRAMMES.map((programme) => [
    programme.tag,
    new Set(programme.titles.map(normalizeTitle)),
  ]),
);

export function programmeTagsForMovieTitle(title: string): FilmProgrammeTag[] {
  const normalized = normalizeTitle(title);
  if (!normalized) return [];
  return FILM_PROGRAMMES.filter((programme) => titleSets.get(programme.tag)?.has(normalized)).map(
    (programme) => programme.tag,
  );
}

/**
 * Feed mentions of a programme are untrusted because they also occur in old
 * synopsis text and one-off partner previews. Replace them with the current,
 * officially curated title match while preserving physical event tags.
 */
export function applyCuratedProgrammeTags(tags: ShowtimeTags, movieTitle: string): ShowtimeTags {
  const programmes = programmeTagsForMovieTitle(movieTitle);
  const physicalEvents = tags.events.filter(
    (event) => event !== "Filmporten" && event !== "Biografklub Danmark",
  );
  return { ...tags, events: Array.from(new Set([...physicalEvents, ...programmes])) };
}
