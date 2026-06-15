import { XMLParser } from "fast-xml-parser";

/**
 * Normalized records produced by the Kultunaut XML parser.
 * These are the shape consumed by the importer; field names mirror the
 * database columns to keep mapping trivial.
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
  poster: { a: string; b: string; c: string; d: string };
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

const attrOrChild = (n: AnyNode, ...keys: string[]): string => {
  if (!n || typeof n !== "object") return "";
  const obj = n as Record<string, unknown>;
  for (const k of keys) {
    const attr = obj[`@_${k}`];
    if (attr !== undefined && attr !== null && attr !== "") return String(attr).trim();
    const child = obj[k];
    if (child !== undefined && child !== null) {
      const t = textOf(child as AnyNode);
      if (t) return t;
    }
  }
  return "";
};

const toInt = (v: string, fallback = 0): number => {
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
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean);

const parseMovieNode = (n: AnyNode): ParsedMovie | null => {
  if (!n || typeof n !== "object") return null;
  const external_id = attrOrChild(n, "movieId", "id");
  if (!external_id) return null;

  const poster = attrOrChild(n, "poster", "posterUrl", "image");
  const genre = splitList(attrOrChild(n, "genre", "genres"));

  return {
    external_id,
    title: attrOrChild(n, "title", "name") || "Ukendt titel",
    original_title: attrOrChild(n, "originalTitle") || null,
    runtime: toInt(attrOrChild(n, "runtime", "length", "duration"), 0),
    genre,
    year: toInt(attrOrChild(n, "year", "productionYear"), 0),
    director: attrOrChild(n, "director") || "",
    rating: attrOrChild(n, "rating", "censorship") || "",
    synopsis: attrOrChild(n, "synopsis", "description", "summary") || "",
    poster: { a: poster, b: poster, c: poster, d: poster },
  };
};

const parseCinemaNode = (n: AnyNode): ParsedCinema | null => {
  if (!n || typeof n !== "object") return null;
  const external_id = attrOrChild(n, "theaterId", "cinemaId", "id");
  if (!external_id) return null;

  return {
    external_id,
    name: attrOrChild(n, "name", "title") || "Ukendt biograf",
    city: attrOrChild(n, "city", "town") || "",
    address: attrOrChild(n, "address", "street") || "",
    description: attrOrChild(n, "description") || "",
    screens: toInt(attrOrChild(n, "screens", "halls"), 1),
    latitude: toFloat(attrOrChild(n, "latitude", "lat")),
    longitude: toFloat(attrOrChild(n, "longitude", "lng", "lon")),
  };
};

const parseTimeNode = (
  n: AnyNode,
  movieId: string,
  cinemaId: string,
): ParsedShowtime | null => {
  if (!n || typeof n !== "object") return null;

  const date = attrOrChild(n, "date", "day");
  const start = attrOrChild(n, "startTime", "start", "time");
  if (!date || !start) return null;

  return {
    movie_external_id: movieId,
    cinema_external_id: cinemaId,
    date,
    times: [start],
    hall: attrOrChild(n, "hall", "screen", "auditorium") || "",
    ticket_url: attrOrChild(n, "ticketUrl", "ticket_url", "bookingUrl") || null,
  };
};

/**
 * Parse a Kultunaut XML payload into normalized movies, cinemas, and showtimes.
 *
 * The parser is intentionally tolerant: it accepts values supplied as either
 * XML attributes (e.g. `<movie movieId="42">`) or child elements
 * (e.g. `<movie><movieId>42</movieId></movie>`), and treats unknown branches
 * as no-ops. We walk any `<event>` / `<show>` / `<screening>` containers and
 * pick out the `<movie>`, `<theater>`/`<cinema>`, and `<time>`/`<showtime>`
 * children, so future structural tweaks from the Kultunaut feed don't break
 * the import.
 */
export function parseKultunautXml(xml: string): ParsedKultunaut {
  const doc = parser.parse(xml) as Record<string, unknown>;

  const movies = new Map<string, ParsedMovie>();
  const cinemas = new Map<string, ParsedCinema>();
  const showtimes: ParsedShowtime[] = [];

  const handleEventLike = (node: AnyNode) => {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;

    const movieNodes = [
      ...toArray(obj.movie),
      ...toArray(obj.film),
    ] as AnyNode[];
    const cinemaNodes = [
      ...toArray(obj.theater),
      ...toArray(obj.cinema),
    ] as AnyNode[];
    const timeNodes = [
      ...toArray(obj.time),
      ...toArray(obj.showtime),
      ...toArray(obj.screening),
    ] as AnyNode[];

    const parsedMovies = movieNodes
      .map(parseMovieNode)
      .filter((m): m is ParsedMovie => m !== null);
    const parsedCinemas = cinemaNodes
      .map(parseCinemaNode)
      .filter((c): c is ParsedCinema => c !== null);

    for (const m of parsedMovies) movies.set(m.external_id, m);
    for (const c of parsedCinemas) cinemas.set(c.external_id, c);

    // Showtime needs a movie + cinema context. Use the first parsed of each
    // when not specified inline; otherwise read IDs from the time node itself.
    const defaultMovieId = parsedMovies[0]?.external_id ?? "";
    const defaultCinemaId = parsedCinemas[0]?.external_id ?? "";

    for (const t of timeNodes) {
      const movieId =
        attrOrChild(t, "movieId", "movie_id") || defaultMovieId;
      const cinemaId =
        attrOrChild(t, "theaterId", "cinemaId", "cinema_id") || defaultCinemaId;
      if (!movieId || !cinemaId) continue;
      const st = parseTimeNode(t, movieId, cinemaId);
      if (st) showtimes.push(st);
    }
  };

  // Walk top-level containers. Kultunaut historically wraps records in
  // <kultunaut>, <events>, or directly as repeated <event> nodes.
  const containers: AnyNode[] = [];
  for (const key of Object.keys(doc)) {
    containers.push(doc[key] as AnyNode);
  }

  const visit = (n: AnyNode) => {
    if (!n || typeof n !== "object") return;
    const obj = n as Record<string, unknown>;
    handleEventLike(obj);
    for (const key of ["event", "events", "show", "screening", "item"]) {
      for (const child of toArray(obj[key]) as AnyNode[]) visit(child);
    }
  };
  for (const c of containers) visit(c);

  return { movies, cinemas, showtimes };
}
