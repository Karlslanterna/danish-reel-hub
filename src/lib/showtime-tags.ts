/**
 * Normalization of screening metadata coming from the Kultunaut feed.
 *
 * The feed expresses screening type, language and event information in free
 * text (titles, hall names, attributes such as `subtitled="da"`). Different
 * cinemas spell the same concept differently ("Org. version", "Original
 * version", "Originalversion"), so every raw value is mapped to one canonical
 * user-facing label BEFORE it is stored. Filter option lists are then built
 * from the stored values, which guarantees that duplicates never surface.
 */

export type ShowtimeTags = {
  formats: string[];
  languages: string[];
  events: string[];
};

export const emptyTags = (): ShowtimeTags => ({ formats: [], languages: [], events: [] });

type Rule = { re: RegExp; label: string };

/** Screening type — "Visningstype". */
const FORMAT_RULES: Rule[] = [
  { re: /\bimax\b/, label: "IMAX" },
  { re: /\b4\s?dx\b/, label: "4DX" },
  { re: /\bdolby\s?cinema\b/, label: "Dolby Cinema" },
  { re: /\b(3-?\s?d)\b/, label: "3D" },
  { re: /\b(2-?\s?d)\b/, label: "2D" },
];

/** Language / subtitles — "Sprog". */
const LANGUAGE_RULES: Rule[] = [
  { re: /\bdansk\s*(tale|version|dub\w*)\b|\bdubbet\b|\bdubbed\b|\bda\.?\s*tale\b/, label: "Dansk tale" },
  {
    re: /\bdansk(e)?\s*(tekst\w*|undertekst\w*)\b|\bda\.?\s*tekst\w*\b|\bdk\s*tekst\w*\b|\bsubtitled[-_ ]?da\b/,
    label: "Danske undertekster",
  },
  { re: /\bengelsk(e)?\s*(tekst\w*|undertekst\w*)\b|\ben\.?\s*tekst\w*\b/, label: "Engelske undertekster" },
  {
    re: /\borg\.?\s*version\b|\boriginal\s*version\b|\boriginalversion\b|\boriginal\s*tale\b|\bov\b/,
    label: "Originalversion",
  },
  { re: /\bengelsk\s*tale\b|\bengelsk\s*version\b/, label: "Engelsk tale" },
];

/** Special screenings / events — "Arrangement". */
const EVENT_RULES: Rule[] = [
  { re: /\bbaby\s?bio\b|\bbabybiograf\b/, label: "Babybio" },
  { re: /\bsenior\s?bio\b|\bseniorbiograf\b/, label: "Seniorbio" },
  { re: /\bformiddags\s?bio\b|\bmorgen\s?bio\b/, label: "Formiddagsbio" },
  { re: /\bopen[-\s]?air\b|\bfriluftsbio\b|\bdrive[-\s]?in\b/, label: "Open Air" },
  { re: /\bopera\b/, label: "Opera" },
  { re: /\bkoncert\b|\bconcert\b|\blive\s?in\s?concert\b/, label: "Koncert" },
  { re: /\bforedrag\b|\bintroduktion\s+ved\b|\bfilmintro\b/, label: "Foredrag" },
  { re: /\bstrikke\s?bio\b/, label: "Strikkebio" },
  { re: /\bskole\s?bio\b/, label: "Skolebio" },
  { re: /\bs(æ|ae)r\s?visning\b|\bspecial\s?screening\b/, label: "Særvisning" },
  { re: /\bballet\b/, label: "Ballet" },
  { re: /\bteater\b|\btheatre\b/, label: "Teater" },
  { re: /\bfilmklub\b|\bfilm\s?club\b/, label: "Filmklub" },
  { re: /\bsing[-\s]?along\b|\bsyng[-\s]?med\b/, label: "Sing-along" },
  { re: /\bfestival\b/, label: "Festival" },
  { re: /\bpremiere\s?fest\b|\bgallapremiere\b|\bgalla\b/, label: "Galla" },
];

const norm = (raw: string) =>
  raw
    .toLowerCase()
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const matchAll = (rules: Rule[], text: string): string[] => {
  const t = norm(text);
  if (!t) return [];
  const out: string[] = [];
  for (const r of rules) {
    if (r.re.test(t) && !out.includes(r.label)) out.push(r.label);
  }
  return out;
};

const matchOne = (rules: Rule[], raw: string): string | null => {
  const [first] = matchAll(rules, raw);
  return first ?? null;
};

export const normalizeFormat = (raw: string) => matchOne(FORMAT_RULES, raw);
export const normalizeLanguage = (raw: string) => matchOne(LANGUAGE_RULES, raw);
export const normalizeEvent = (raw: string) => matchOne(EVENT_RULES, raw);

/** Extract every canonical tag mentioned anywhere in a free-text fragment. */
export function extractTags(...texts: Array<string | null | undefined>): ShowtimeTags {
  const joined = texts.filter(Boolean).join(" · ");
  return {
    formats: matchAll(FORMAT_RULES, joined),
    languages: matchAll(LANGUAGE_RULES, joined),
    events: matchAll(EVENT_RULES, joined),
  };
}

export function mergeTags(a: ShowtimeTags, b: ShowtimeTags): ShowtimeTags {
  const uniq = (x: string[], y: string[]) => Array.from(new Set([...x, ...y]));
  return {
    formats: uniq(a.formats, b.formats),
    languages: uniq(a.languages, b.languages),
    events: uniq(a.events, b.events),
  };
}

/** Sort order used for filter option lists (stable + user friendly). */
const ORDER: Record<string, string[]> = {
  formats: ["2D", "3D", "IMAX", "4DX", "Dolby Cinema"],
  languages: ["Originalversion", "Dansk tale", "Danske undertekster", "Engelsk tale", "Engelske undertekster"],
  events: EVENT_RULES.map((r) => r.label),
};

export function sortTagOptions(kind: keyof ShowtimeTags, values: string[]): string[] {
  const order = ORDER[kind] ?? [];
  return Array.from(new Set(values)).sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b, "da");
  });
}
