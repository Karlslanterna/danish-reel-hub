export const SPECIAL_EVENT_TAGS = [
  "Babybio",
  "Seniorbio",
  "Filmporten",
  "Biografklub Danmark",
] as const;

export type SpecialEventTag = (typeof SPECIAL_EVENT_TAGS)[number];

export type SpecialEventDefinition = {
  tag: SpecialEventTag;
  path: "/babybio" | "/seniorbio" | "/filmporten" | "/biografklub-danmark";
  title: string;
  description: string;
  hero: string;
  sub: string;
};

export const SPECIAL_EVENTS: readonly SpecialEventDefinition[] = [
  {
    tag: "Babybio",
    path: "/babybio",
    title: "Babybio – Find film og spilletider | Lanterna",
    description:
      "Find aktuelle Babybio-forestillinger i biografer i hele Danmark. Se film, spilletider og køb billetter direkte hos biografen.",
    hero: "Babybio i nærheden af dig",
    sub: "Find rolige biografforestillinger, hvor du kan tage din baby med.",
  },
  {
    tag: "Seniorbio",
    path: "/seniorbio",
    title: "Seniorbio – Find film og spilletider | Lanterna",
    description:
      "Find aktuelle Seniorbio-forestillinger i biografer i hele Danmark. Se film, spilletider og køb billetter direkte hos biografen.",
    hero: "Seniorbio i nærheden af dig",
    sub: "Se aktuelle Seniorbio-film og find den visning, der passer dig.",
  },
  {
    tag: "Filmporten",
    path: "/filmporten",
    title: "Filmporten-film i biografen – Se spilletider | Lanterna",
    description:
      "Find aktuelle Filmporten-film og spilletider i danske biografer. Sammenlign visninger og køb billetter direkte hos biografen.",
    hero: "Filmporten-film i biografen",
    sub: "Find aktuelle film og visninger fra Filmportens program.",
  },
  {
    tag: "Biografklub Danmark",
    path: "/biografklub-danmark",
    title: "Biografklub Danmark-film – Se spilletider | Lanterna",
    description:
      "Find aktuelle film fra Biografklub Danmark og se spilletider i hele landet. Køb billetter direkte hos biografen.",
    hero: "Film fra Biografklub Danmark",
    sub: "Se sæsonens aktuelle klubfilm og find en visning i nærheden.",
  },
] as const;

export const specialEventDefinition = (tag: SpecialEventTag) =>
  SPECIAL_EVENTS.find((event) => event.tag === tag)!;

export const isSpecialEventTag = (value: string): value is SpecialEventTag =>
  (SPECIAL_EVENT_TAGS as readonly string[]).includes(value);

/** Only the four intentionally curated choices are exposed in the filter UI. */
export function publicSpecialEventOptions(values: string[]): SpecialEventTag[] {
  const available = new Set(values);
  return SPECIAL_EVENT_TAGS.filter((tag) => available.has(tag));
}
