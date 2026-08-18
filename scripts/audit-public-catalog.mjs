import fs from "node:fs/promises";

const PAGE_SIZE = 1000;
// Must match src/lib/date-window.ts. The public audit is only useful when it
// measures the exact catalog users can select in the UI.
const WINDOW_DAYS = 30;

function copenhagenDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Copenhagen",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days, 12)).toISOString().slice(0, 10);
}

async function loadPublicConfig() {
  const text = await fs.readFile(
    new URL("../src/integrations/supabase/public-config.ts", import.meta.url),
    "utf8",
  );
  const url = text.match(/PUBLIC_SUPABASE_URL\s*=\s*["']([^"']+)/)?.[1];
  const key = text.match(/PUBLIC_SUPABASE_PUBLISHABLE_KEY\s*=\s*["']([^"']+)/)?.[1];
  if (!url || !key) throw new Error("Could not read public Supabase config");
  return { url, key };
}

async function fetchPages({ baseUrl, key, table, select, configure }) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = new URL(`/rest/v1/${table}`, baseUrl);
    url.searchParams.set("select", select);
    configure?.(url);
    const response = await fetch(url, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${offset}-${offset + PAGE_SIZE - 1}`,
        "Range-Unit": "items",
      },
    });
    if (!response.ok) {
      throw new Error(`${table} fetch failed (${response.status}): ${await response.text()}`);
    }
    const page = await response.json();
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

const normalizeTitle = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " og ")
    .replace(/[^a-z0-9æøå]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizePresentationTitle = (value) =>
  normalizeTitle(value)
    .replace(
      /\b(2d|3d|4dx|imax|org tale|original tale|dansk tale|tekstet|dk tale|eng tale)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

const GENERIC_EVENT_TITLE =
  /^(særvisning|saervisning|børnebiffen|bornebiffen|babybio|seniorbio|strikkebio|formiddagsbio|filmklub|specialvisning|event)(\b|\s*[-:])/i;
const NON_FILM_TITLE =
  /^(opera|ballet|teater|koncert|stand[ -]?up|live event|foredrag)(\b|\s*[-:])/i;

function posterUrl(movie) {
  if (movie.tmdb_poster_url) return String(movie.tmdb_poster_url).trim();
  const poster = movie.poster;
  if (!poster || typeof poster !== "object") return "";
  return String(poster.url ?? poster.a ?? poster.b ?? "").trim();
}

function groupBy(rows, keyOf) {
  const map = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const group = map.get(key) ?? [];
    group.push(row);
    map.set(key, group);
  }
  return map;
}

function countArrayValues(rows, field) {
  const counts = new Map();
  for (const row of rows) {
    for (const raw of Array.isArray(row[field]) ? row[field] : []) {
      const value = String(raw ?? "").trim();
      if (!value) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "da"));
}

function printRows(title, rows, fields, limit = 80) {
  console.log(`\n=== ${title} (${rows.length}) ===`);
  for (const row of rows.slice(0, limit)) {
    const out = {};
    for (const field of fields) out[field] = row[field];
    console.log(JSON.stringify(out));
  }
  if (rows.length > limit) console.log(`... ${rows.length - limit} more`);
}

function decodeHtml(value) {
  return value
    .replace(/<[^>]+>/g, "")
    .replaceAll("&amp;", "&")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .trim();
}

function renderedTitleIdentity(value) {
  return normalizePresentationTitle(value)
    .replace(/\b(?:19|20)\d{2}\b$/u, "")
    .replace(/\band\b/gu, " og ")
    .replace(/\s+/g, " ")
    .trim();
}

function renderedTitleYear(value) {
  const year = Number(value.match(/\s*[([]\s*((?:19|20)\d{2})\s*[)\]]\s*$/u)?.[1] ?? 0);
  return year > 1880 ? year : null;
}

function hasCompatibleRenderedPair(group) {
  for (let left = 0; left < group.length; left += 1) {
    for (let right = left + 1; right < group.length; right += 1) {
      const a = renderedTitleYear(group[left].title);
      const b = renderedTitleYear(group[right].title);
      if (a === null || b === null || Math.abs(a - b) <= 1) return true;
    }
  }
  return false;
}

const start = copenhagenDate();
const end = addDays(start, WINDOW_DAYS);
const { url, key } = await loadPublicConfig();

const [movies, screenings] = await Promise.all([
  fetchPages({
    baseUrl: url,
    key,
    table: "movies_ranked",
    select:
      "id,title,original_title,year,runtime,genre,slug,external_id,tmdb_id,tmdb_status,tmdb_skip_reason,poster,tmdb_poster_url,screening_count,next_screening_date",
    configure: (requestUrl) => {
      requestUrl.searchParams.set("screening_count", "gt.0");
      requestUrl.searchParams.set("order", "screening_count.desc,title.asc");
    },
  }),
  fetchPages({
    baseUrl: url,
    key,
    table: "screenings",
    select:
      "movie_id,cinema_id,source,starts_at,local_date,local_time,formats,languages,events,ticket_url",
    configure: (requestUrl) => {
      requestUrl.searchParams.set("local_date", `gte.${start}`);
      requestUrl.searchParams.append("local_date", `lte.${end}`);
      requestUrl.searchParams.set("order", "local_date.asc,local_time.asc");
    },
  }),
]);

const activeMovieIds = new Set(screenings.map((row) => row.movie_id));
const activeMovies = movies.filter((movie) => activeMovieIds.has(movie.id));
const screeningCountByMovie = new Map();
for (const row of screenings)
  screeningCountByMovie.set(row.movie_id, (screeningCountByMovie.get(row.movie_id) ?? 0) + 1);

console.log("PUBLIC CATALOG AUDIT");
console.log(
  JSON.stringify(
    {
      window: { start, end },
      activeMovies: activeMovies.length,
      physicalScreenings: screenings.length,
      sources: Object.fromEntries(
        [...groupBy(screenings, (row) => row.source).entries()].map(([source, rows]) => [
          source,
          rows.length,
        ]),
      ),
    },
    null,
    2,
  ),
);

const genericTitles = activeMovies.filter((movie) =>
  GENERIC_EVENT_TITLE.test(String(movie.title ?? "").trim()),
);
const nonFilmTitles = activeMovies.filter((movie) =>
  NON_FILM_TITLE.test(String(movie.title ?? "").trim()),
);
const genericWithTmdb = genericTitles.filter((movie) => movie.tmdb_id);
const weakMovies = activeMovies.filter((movie) => {
  const genres = Array.isArray(movie.genre) ? movie.genre.filter(Boolean) : [];
  return !movie.tmdb_id && !Number(movie.year) && !Number(movie.runtime) && genres.length === 0;
});

printRows("Generic/event-shell titles", genericTitles, [
  "id",
  "title",
  "year",
  "runtime",
  "genre",
  "tmdb_id",
  "tmdb_status",
  "external_id",
  "screening_count",
]);
printRows("Likely non-film titles", nonFilmTitles, [
  "id",
  "title",
  "year",
  "runtime",
  "genre",
  "tmdb_id",
  "external_id",
  "screening_count",
]);
printRows("Generic titles incorrectly enriched by TMDb candidate", genericWithTmdb, [
  "id",
  "title",
  "tmdb_id",
  "tmdb_status",
  "tmdb_poster_url",
  "screening_count",
]);
printRows("Very weak active movie records", weakMovies, [
  "id",
  "title",
  "external_id",
  "tmdb_status",
  "tmdb_skip_reason",
  "screening_count",
]);

const exactDuplicateGroups = [
  ...groupBy(activeMovies, (movie) => normalizeTitle(movie.title)).entries(),
]
  .filter(([, group]) => group.length > 1)
  .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
console.log(`\n=== Exact normalized title duplicate groups (${exactDuplicateGroups.length}) ===`);
for (const [title, group] of exactDuplicateGroups.slice(0, 80)) {
  console.log(
    JSON.stringify({
      title,
      movies: group.map((movie) => ({
        id: movie.id,
        title: movie.title,
        year: movie.year,
        tmdb_id: movie.tmdb_id,
        external_id: movie.external_id,
        screenings: screeningCountByMovie.get(movie.id) ?? 0,
      })),
    }),
  );
}

const presentationDuplicateGroups = [
  ...groupBy(activeMovies, (movie) => normalizePresentationTitle(movie.title)).entries(),
]
  .filter(([, group]) => group.length > 1)
  .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
console.log(
  `\n=== Presentation-normalized duplicate groups (${presentationDuplicateGroups.length}) ===`,
);
for (const [title, group] of presentationDuplicateGroups.slice(0, 80)) {
  console.log(
    JSON.stringify({
      title,
      movies: group.map((movie) => ({
        id: movie.id,
        title: movie.title,
        year: movie.year,
        tmdb_id: movie.tmdb_id,
        external_id: movie.external_id,
        screenings: screeningCountByMovie.get(movie.id) ?? 0,
      })),
    }),
  );
}

const posterCollisions = [...groupBy(activeMovies, posterUrl).entries()]
  .map(([poster, group]) => ({
    poster,
    group,
    titles: new Set(group.map((movie) => normalizeTitle(movie.title))),
  }))
  .filter(({ poster, group, titles }) => poster && group.length > 1 && titles.size > 1)
  .sort((a, b) => b.group.length - a.group.length);
console.log(`\n=== Poster URLs shared by different titles (${posterCollisions.length}) ===`);
for (const collision of posterCollisions.slice(0, 50)) {
  console.log(
    JSON.stringify({
      poster: collision.poster,
      movies: collision.group.map((movie) => ({
        id: movie.id,
        title: movie.title,
        tmdb_id: movie.tmdb_id,
      })),
    }),
  );
}

for (const [label, values] of [
  ["Genres", countArrayValues(activeMovies, "genre")],
  ["Formats", countArrayValues(screenings, "formats")],
  ["Languages", countArrayValues(screenings, "languages")],
  ["Events", countArrayValues(screenings, "events")],
]) {
  console.log(`\n=== ${label} (${values.length}) ===`);
  for (const [value, count] of values) console.log(`${value}: ${count}`);
}

const malformedScreenings = screenings.filter(
  (row) =>
    !/^\d{4}-\d{2}-\d{2}$/.test(String(row.local_date ?? "")) ||
    !/^\d{2}:\d{2}/.test(String(row.local_time ?? "")) ||
    !row.movie_id ||
    !row.cinema_id,
);
printRows("Malformed screening rows", malformedScreenings, [
  "movie_id",
  "cinema_id",
  "source",
  "starts_at",
  "local_date",
  "local_time",
]);

const summary = {
  genericTitles: genericTitles.length,
  likelyNonFilmTitles: nonFilmTitles.length,
  genericWithTmdb: genericWithTmdb.length,
  weakMovies: weakMovies.length,
  exactDuplicateGroups: exactDuplicateGroups.length,
  presentationDuplicateGroups: presentationDuplicateGroups.length,
  posterCollisions: posterCollisions.length,
  malformedScreenings: malformedScreenings.length,
};
console.log("\nAUDIT SUMMARY");
console.log(JSON.stringify(summary, null, 2));

// The database audit above measures source records. This rendered audit is the
// regression guard the old report lacked: source labels can differ yet become
// duplicate cards only after the public title transformations run.
const publicBaseUrl = process.env.AUDIT_BASE_URL ?? "https://lanterna.dk";
const homeResponse = await fetch(publicBaseUrl, { signal: AbortSignal.timeout(45_000) });
if (!homeResponse.ok) {
  throw new Error(`Rendered catalog fetch failed (${homeResponse.status})`);
}
const homeHtml = await homeResponse.text();
const cards = [];
for (const match of homeHtml.matchAll(/<a href="\/film\/([^"]+)"[^>]*>(.*?)<\/a>/gs)) {
  const body = match[2];
  const titleMatch = body.match(/<h3[^>]*>(.*?)<\/h3>/s);
  if (!titleMatch) continue;
  cards.push({
    slug: match[1],
    title: decodeHtml(titleMatch[1]),
    hasPoster: /<img\s/iu.test(body),
  });
}
const renderedDuplicates = [...groupBy(cards, (card) => renderedTitleIdentity(card.title))]
  .filter(([, group]) => group.length > 1 && hasCompatibleRenderedPair(group))
  .map(([identity, group]) => ({ identity, cards: group }));

console.log("\nRENDERED PUBLIC CATALOG");
console.log(
  JSON.stringify(
    {
      cards: cards.length,
      cardsWithoutPoster: cards.filter((card) => !card.hasPoster).length,
      duplicateGroups: renderedDuplicates.length,
      duplicates: renderedDuplicates,
    },
    null,
    2,
  ),
);

if (renderedDuplicates.length > 0) {
  throw new Error(`Rendered public catalog contains ${renderedDuplicates.length} duplicate groups`);
}
