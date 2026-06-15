import { XMLParser } from "fast-xml-parser";

/**
 * Normalized records produced by the Kultunaut XML parser.
 * These mirror the database columns to keep mapping trivial.
 */
export type ParsedMovie = {
  external_id: string;
  title: string;
  original_title: string | null;
  runtime: number;
  genre: string[];
  year: number;
  director: string;
  rating: string;
  synopsis: string;
  poster: { a: string; b: string; c: string; d: string; url?: string };
};

export type ParsedCinema = {
  external_id: string;
  name: string;
  city: string;
  address: string;
  description: string;
  screens: number;
  latitude: number | null;
  longitude: number | null;
};

export type ParsedShowtime = {
  movie_external_id: string;
  cinema_external_id: string;
  date: string;
  times: string[];
  hall: string;
  ticket_url: string | null;
};

export type ParsedKultunaut = {
  movies: Map<string, ParsedMovie>;
  cinemas: Map<string, ParsedCinema>;
  showtimes: ParsedShowtime[];
};

type AnyNode = Record<string, unknown> | string | number | undefined | null;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  parseAttributeValue: false,
  parseTagValue: false,
  allowBooleanAttributes: true,
});

const toArray = <T>(v: T | T[] | undefined | null): T[] => {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
};

const textOf = (n: AnyNode): string => {
  if (n === null || n === undefined) return "";
  if (typeof n === "string") return n.trim();
  if (typeof n === "number") return String(n);
  if (typeof n === "object") {
    const t = (n as Record<string, unknown>)["#text"];
    if (typeof t === "string") return t.trim();
    if (typeof t === "number") return String(t);
  }
  return "";
};

/**
 * Read a value from an XML node by trying attribute (`@_key`) then child
 * element, across one or more candidate key names. Keys are matched
 * case-insensitively so feeds using `Overskrift`, `overskrift`, or
 * `OVERSKRIFT` all resolve.
 */
const readField = (n: AnyNode, ...keys: string[]): string => {
  if (!n || typeof n !== "object") return "";
  const obj = n as Record<string, unknown>;
  const lowerMap = new Map<string, string>();
  for (const realKey of Object.keys(obj)) {
    lowerMap.set(realKey.toLowerCase(), realKey);
  }
  for (const k of keys) {
    const lk = k.toLowerCase();
    const attrReal = lowerMap.get(`@_${lk}`);
    if (attrReal) {
      const v = obj[attrReal];
      if (v !== undefined && v !== null && v !== "") return String(v).trim();
    }
    const childReal = lowerMap.get(lk);
    if (childReal) {
      const v = obj[childReal];
      if (v !== undefined && v !== null) {
        const t = textOf(v as AnyNode);
        if (t) return t;
      }
    }
  }
  return "";
};

const toInt = (v: string, fallback = 0): number => {
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

const toFloat = (v: string): number | null => {
  if (!v) return null;
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const splitList = (v: string): string[] =>
  v
    .split(/[,;|/]/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Slugify a Danish string into a URL-safe, stable identifier.
 * Used to derive external_ids when the feed has no stable per-movie or
 * per-cinema identifier (Kultunaut's `Eventid` is per-screening).
 */
const slugifyId = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "oe")
    .replace(/å/g, "aa")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Normalize a Kultunaut date into ISO `YYYY-MM-DD`.
 * Kultunaut historically emits `YYYY-MM-DD`, but also occasionally
 * `DD-MM-YYYY` or `DD/MM-YYYY`. Anything we can't parse returns "".
 */
const normalizeDate = (raw: string): string => {
  if (!raw) return "";
  const v = raw.trim();
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = v.match(/^(\d{2})[-/.](\d{2})[-/.](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return "";
};

/**
 * Normalize a Kultunaut time into `HH:MM`.
 * Accepts `HH:MM`, `HHMM`, and `H.MM`. Returns "" on failure.
 */
const normalizeTime = (raw: string): string => {
  if (!raw) return "";
  const v = raw.trim();
  let m = v.match(/^(\d{1,2}):(\d{2})/);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  m = v.match(/^(\d{1,2})\.(\d{2})/);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  m = v.match(/^(\d{2})(\d{2})$/);
  if (m) return `${m[1]}:${m[2]}`;
  return "";
};

/**
 * Parse a single Kultunaut `<Event>` node into a (movie, cinema, showtime)
 * triple. The Kultunaut feed is event-shaped: each event represents one
 * screening of one movie at one venue on one date+time. We collapse
 * repeated events into stable movies/cinemas by slugifying the title and
 * the venue identity (name + postal code).
 */
type EventTriple = {
  movie: ParsedMovie | null;
  cinema: ParsedCinema | null;
  showtime: ParsedShowtime | null;
};

const parseEventNode = (n: AnyNode): EventTriple => {
  if (!n || typeof n !== "object") {
    return { movie: null, cinema: null, showtime: null };
  }

  // ---- Movie identity & metadata ----
  const title =
    readField(n, "Overskrift", "Titel", "Title", "Navn", "Name") || "";
  const originalTitle =
    readField(n, "OriginalTitel", "OriginalTitle", "EngelskTitel") || null;
  const synopsis =
    readField(n, "Beskrivelse", "LangBeskrivelse", "Description", "Resume") ||
    "";
  const director = readField(n, "Instruktor", "Instruktør", "Director") || "";
  const rating =
    readField(n, "Censur", "Aldersgraense", "Aldersgrænse", "Rating") || "";
  const runtime = toInt(
    readField(n, "Spilletid", "Varighed", "Runtime", "Duration"),
    0,
  );
  const year = toInt(readField(n, "ProductionYear", "Aar", "År", "Year"), 0);
  const genre = splitList(
    readField(n, "Genre", "Genrer", "Kategori", "Kategorier"),
  );
  const posterUrl =
    readField(n, "Billede", "BilledeStor", "ImageUrl", "Poster", "PosterUrl") ||
    "";

  const movie: ParsedMovie | null = title
    ? {
        external_id: slugifyId(title) || `event-${readField(n, "Eventid", "EventId", "Id")}`,
        title,
        original_title: originalTitle,
        runtime,
        genre,
        year,
        director,
        rating,
        synopsis,
        poster: {
          a: posterUrl,
          b: posterUrl,
          c: posterUrl,
          d: posterUrl,
          url: posterUrl || undefined,
        },
      }
    : null;

  // ---- Cinema identity & metadata ----
  const venueName = readField(n, "Sted", "Spillested", "Venue", "VenueName") || "";
  const address = readField(n, "Adresse", "Address") || "";
  const city = readField(n, "By", "City", "Town") || "";
  const postnr = readField(n, "Postnr", "PostalCode", "ZipCode") || "";
  const latitude = toFloat(readField(n, "Latitude", "Lat"));
  const longitude = toFloat(readField(n, "Longitude", "Lng", "Lon"));

  const cinema: ParsedCinema | null = venueName
    ? {
        external_id:
          slugifyId(`${venueName}-${postnr || city || address}`) ||
          slugifyId(venueName),
        name: venueName,
        city: postnr ? (city ? `${postnr} ${city}` : postnr) : city,
        address,
        description: "",
        screens: 1,
        latitude,
        longitude,
      }
    : null;

  // ---- Showtime ----
  const date = normalizeDate(readField(n, "StartDato", "Dato", "Date"));
  const time = normalizeTime(readField(n, "StartTid", "Tid", "Time", "StartTime"));
  const hall = readField(n, "Sal", "Hall", "Screen", "Auditorium") || "";
  const ticketUrl =
    readField(n, "BilletURL", "TicketURL", "TicketUrl", "BookingURL", "BookingUrl") ||
    null;

  const showtime: ParsedShowtime | null =
    movie && cinema && date && time
      ? {
          movie_external_id: movie.external_id,
          cinema_external_id: cinema.external_id,
          date,
          times: [time],
          hall,
          ticket_url: ticketUrl,
        }
      : null;

  return { movie, cinema, showtime };
};

/**
 * Recursively collect every `<Event>` node from a Kultunaut document.
 * Kultunaut wraps records in different roots depending on feed type
 * (`<kultunaut>`, `<Events>`, `<EventList>`, etc.) so we walk every
 * branch and pick up case-insensitive `Event` children.
 */
const collectEvents = (n: AnyNode, out: AnyNode[]): void => {
  if (!n || typeof n !== "object") return;
  const obj = n as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key.startsWith("@_") || key === "#text") continue;
    if (key.toLowerCase() === "event") {
      for (const child of toArray(obj[key]) as AnyNode[]) out.push(child);
      continue;
    }
    const v = obj[key];
    if (Array.isArray(v)) {
      for (const child of v as AnyNode[]) collectEvents(child, out);
    } else if (v && typeof v === "object") {
      collectEvents(v as AnyNode, out);
    }
  }
};

/**
 * Parse a Kultunaut XML payload into normalized movies, cinemas, and
 * showtimes.
 *
 * The Kultunaut feed is event-shaped: each `<Event>` element is one
 * screening (one movie + one venue + one date+time). We collapse repeated
 * events into deduplicated movies and cinemas using slugified identities:
 *
 *  - movie.external_id   = slug(Overskrift)
 *  - cinema.external_id  = slug(Sted + Postnr)
 *  - one showtime per event, later grouped by (movie, cinema, date, hall)
 *    in the importer.
 *
 * Recognized Danish fields include: Event, Eventid, Overskrift, Beskrivelse,
 * Sted, Adresse, By, Postnr, Latitude, Longitude, StartDato, StartTid,
 * plus common variants (Titel, Spilletid, Instruktør, Genre, Billede,
 * BilletURL, etc.). Field lookup is case-insensitive and tolerates values
 * provided as either attributes or child elements.
 */
export function parseKultunautXml(xml: string): ParsedKultunaut {
  const doc = parser.parse(xml) as Record<string, unknown>;

  const movies = new Map<string, ParsedMovie>();
  const cinemas = new Map<string, ParsedCinema>();
  const showtimes: ParsedShowtime[] = [];

  const events: AnyNode[] = [];
  collectEvents(doc, events);

  for (const ev of events) {
    const { movie, cinema, showtime } = parseEventNode(ev);
    if (movie && !movies.has(movie.external_id)) movies.set(movie.external_id, movie);
    if (cinema && !cinemas.has(cinema.external_id)) cinemas.set(cinema.external_id, cinema);
    if (showtime) showtimes.push(showtime);
  }

  return { movies, cinemas, showtimes };
}
