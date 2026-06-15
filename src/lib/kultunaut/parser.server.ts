import { XMLParser } from "fast-xml-parser";

/**
 * Normalized records produced by the Kultunaut XML parser.
 *
 * The Kultunaut feed follows the Google Movie Showtimes XML schema
 * (http://www.google.com/schemas/movieshowtimes/movieshowtimes.xsd):
 *
 *   <xffd>
 *     <theaters>  <theater theaterId="..."> ... </theater>  ... </theaters>
 *     <movies>    <movie movieId="...">     ... </movie>    ... </movies>
 *     <showTimes> <showTime date="YYYYMMDD" theaterId="..." movieId="...">
 *                   <times>
 *                     <time ticketUrl="...">HHMM</time>
 *                     ...
 *                   </times>
 *                 </showTime> ... </showTimes>
 *   </xffd>
 *
 * Field shapes mirror the database columns to keep mapping trivial.
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

const attr = (n: AnyNode, key: string): string => {
  if (!n || typeof n !== "object") return "";
  const v = (n as Record<string, unknown>)[`@_${key}`];
  return v === undefined || v === null ? "" : String(v).trim();
};

const child = (n: AnyNode, key: string): AnyNode => {
  if (!n || typeof n !== "object") return undefined;
  return (n as Record<string, unknown>)[key] as AnyNode;
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

/**
 * Convert `YYYYMMDD` (Google Movie Showtimes date format) into ISO
 * `YYYY-MM-DD`. Tolerates already-ISO input. Returns "" on failure.
 */
const normalizeDate = (raw: string): string => {
  if (!raw) return "";
  const v = raw.trim();
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return "";
};

/**
 * Convert `HHMM` (Google Movie Showtimes time format) into `HH:MM`.
 * Tolerates `HH:MM` input. Returns "" on failure.
 */
const normalizeTime = (raw: string): string => {
  if (!raw) return "";
  const v = raw.trim();
  let m = v.match(/^(\d{1,2}):(\d{2})/);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  m = v.match(/^(\d{1,2})(\d{2})$/);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  return "";
};

/**
 * Pick the Danish-language variant of a multi-language element when
 * present, otherwise fall back to the first un-tagged variant, otherwise
 * the first available. Kultunaut emits e.g.
 *   <officialTitle>
 *     <title>Jeunes mères</title>
 *     <title language="da">Young Mothers</title>
 *   </officialTitle>
 * and we prefer the Danish translation for display.
 */
const pickLocalized = (
  parent: AnyNode,
  childKey: string,
  preferLang = "da",
): { value: string; isLocalized: boolean } => {
  const nodes = toArray(child(parent, childKey)) as AnyNode[];
  if (nodes.length === 0) return { value: "", isLocalized: false };
  const localized = nodes.find((n) => attr(n, "language") === preferLang);
  if (localized) {
    const v = textOf(localized);
    if (v) return { value: v, isLocalized: true };
  }
  const untagged = nodes.find((n) => !attr(n, "language"));
  if (untagged) {
    const v = textOf(untagged);
    if (v) return { value: v, isLocalized: false };
  }
  for (const n of nodes) {
    const v = textOf(n);
    if (v) return { value: v, isLocalized: false };
  }
  return { value: "", isLocalized: false };
};

const parseTheaterNode = (n: AnyNode): ParsedCinema | null => {
  if (!n || typeof n !== "object") return null;
  const theaterId = attr(n, "theaterId");
  if (!theaterId) return null;

  const name = textOf(child(n, "name"));
  const addrNode = child(n, "address");
  const streetAddrNode = child(addrNode, "streetAddress");
  const street = textOf(child(streetAddrNode, "street"));
  const city = textOf(child(addrNode, "city"));
  const postalCode = textOf(child(addrNode, "postalCode"));

  return {
    external_id: theaterId,
    name: name || `Theater ${theaterId}`,
    city: postalCode ? (city ? `${postalCode} ${city}` : postalCode) : city,
    address: street,
    description: "",
    screens: 1,
    latitude: toFloat(textOf(child(n, "latitude"))),
    longitude: toFloat(textOf(child(n, "longitude"))),
  };
};

const parseMovieNode = (n: AnyNode): ParsedMovie | null => {
  if (!n || typeof n !== "object") return null;
  const movieId = attr(n, "movieId");
  if (!movieId) return null;

  // <officialTitle><title>orig</title><title language="da">danish</title></officialTitle>
  const officialTitleNode = child(n, "officialTitle");
  const danish = pickLocalized(officialTitleNode, "title", "da");
  // The original title is the un-tagged variant (no language attr).
  const titleNodes = toArray(child(officialTitleNode, "title")) as AnyNode[];
  const untagged = titleNodes.find((t) => !attr(t, "language"));
  const originalTitle = untagged ? textOf(untagged) : "";

  const displayTitle = danish.value || originalTitle || `Movie ${movieId}`;

  const runtime = toInt(textOf(child(n, "runningTime")), 0);
  const year = toInt(textOf(child(n, "releaseYear")), 0);

  const ratings = toArray(child(child(n, "ratings"), "rating")) as AnyNode[];
  const rating = ratings.length > 0 ? attr(ratings[0], "code") : "";

  const genres = toArray(child(child(n, "genres"), "genre")) as AnyNode[];
  const genreList: string[] = [];
  for (const g of genres) {
    const t = textOf(g);
    if (t) {
      for (const part of t.split(/[/,;|]/).map((s) => s.trim()).filter(Boolean)) {
        if (!genreList.includes(part)) genreList.push(part);
      }
    }
  }

  const thumbnails = toArray(
    child(child(n, "thumbnails"), "thumbnail"),
  ) as AnyNode[];
  const poster = thumbnails.find((t) => attr(t, "type") === "poster") ?? thumbnails[0];
  const posterUrl = poster ? textOf(child(poster, "imageURL")) : "";

  const synopsis = pickLocalized(n, "synopsis", "da").value;

  return {
    external_id: movieId,
    title: displayTitle,
    original_title: originalTitle && originalTitle !== displayTitle ? originalTitle : null,
    runtime,
    genre: genreList,
    year,
    director: "",
    rating,
    synopsis,
    poster: {
      a: posterUrl,
      b: posterUrl,
      c: posterUrl,
      d: posterUrl,
      url: posterUrl || undefined,
    },
  };
};

const parseShowTimeNode = (n: AnyNode): ParsedShowtime[] => {
  if (!n || typeof n !== "object") return [];
  const date = normalizeDate(attr(n, "date"));
  const movieId = attr(n, "movieId");
  const theaterId = attr(n, "theaterId");
  if (!date || !movieId || !theaterId) return [];

  const timesParent = child(n, "times");
  const timeNodes = toArray(child(timesParent, "time")) as AnyNode[];

  const out: ParsedShowtime[] = [];
  for (const t of timeNodes) {
    const time = normalizeTime(textOf(t));
    if (!time) continue;
    out.push({
      movie_external_id: movieId,
      cinema_external_id: theaterId,
      date,
      times: [time],
      hall: "",
      ticket_url: attr(t, "ticketUrl") || null,
    });
  }
  return out;
};

/**
 * Parse a Kultunaut XML payload into normalized movies, cinemas, and
 * showtimes.
 *
 * The feed follows the Google Movie Showtimes XML schema with three
 * top-level sections (`<theaters>`, `<movies>`, `<showTimes>`) wrapped in
 * a single root element. Each `<showTime>` may contain multiple `<time>`
 * children; we emit one ParsedShowtime per `<time>` and let the importer
 * group them back into rows by (movie, cinema, date, hall).
 *
 * Recognized fields:
 *   - theater: theaterId, name, address/streetAddress/street, address/city,
 *              address/postalCode, latitude, longitude
 *   - movie:   movieId, officialTitle/title (with optional language="da"),
 *              runningTime, releaseYear, ratings/rating[code], genres/genre,
 *              thumbnails/thumbnail[type=poster]/imageURL, synopsis
 *   - showTime: date (YYYYMMDD), theaterId, movieId,
 *               times/time (HHMM, ticketUrl)
 */
export function parseKultunautXml(xml: string): ParsedKultunaut {
  const doc = parser.parse(xml) as Record<string, unknown>;

  const movies = new Map<string, ParsedMovie>();
  const cinemas = new Map<string, ParsedCinema>();
  const showtimes: ParsedShowtime[] = [];

  // Find the section parents anywhere in the document tree. The known root
  // is <xffd>, but we walk defensively so future root-tag changes don't
  // break the import.
  const findContainers = (
    n: AnyNode,
    out: { theaters: AnyNode[]; movies: AnyNode[]; showTimes: AnyNode[] },
  ): void => {
    if (!n || typeof n !== "object") return;
    const obj = n as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (key.startsWith("@_") || key === "#text") continue;
      const v = obj[key] as AnyNode;
      if (key === "theaters") out.theaters.push(...(toArray(v) as AnyNode[]));
      else if (key === "movies") out.movies.push(...(toArray(v) as AnyNode[]));
      else if (key === "showTimes") out.showTimes.push(...(toArray(v) as AnyNode[]));
      if (v && typeof v === "object" && !Array.isArray(v)) findContainers(v, out);
      else if (Array.isArray(v)) for (const c of v as AnyNode[]) findContainers(c, out);
    }
  };
  const containers = { theaters: [] as AnyNode[], movies: [] as AnyNode[], showTimes: [] as AnyNode[] };
  findContainers(doc, containers);

  for (const t of containers.theaters) {
    for (const node of toArray(child(t, "theater")) as AnyNode[]) {
      const c = parseTheaterNode(node);
      if (c && !cinemas.has(c.external_id)) cinemas.set(c.external_id, c);
    }
  }
  for (const m of containers.movies) {
    for (const node of toArray(child(m, "movie")) as AnyNode[]) {
      const movie = parseMovieNode(node);
      if (movie && !movies.has(movie.external_id)) movies.set(movie.external_id, movie);
    }
  }
  for (const s of containers.showTimes) {
    for (const node of toArray(child(s, "showTime")) as AnyNode[]) {
      for (const st of parseShowTimeNode(node)) showtimes.push(st);
    }
  }

  return { movies, cinemas, showtimes };
}
