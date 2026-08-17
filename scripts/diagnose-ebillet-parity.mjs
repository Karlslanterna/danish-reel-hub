import fs from "node:fs/promises";

const PAGE_SIZE = 1000;
const API_BASE = "https://flow.ebillet.dk/api";
const LANTERNA_BASE = "https://lanterna.dk";

async function config() {
  const text = await fs.readFile(new URL("../src/integrations/supabase/public-config.ts", import.meta.url), "utf8");
  const url = text.match(/PUBLIC_SUPABASE_URL\s*=\s*["']([^"']+)/)?.[1];
  const key = text.match(/PUBLIC_SUPABASE_PUBLISHABLE_KEY\s*=\s*["']([^"']+)/)?.[1];
  if (!url || !key) throw new Error("Missing public Supabase config");
  return { url, key };
}

function dkDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Copenhagen",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
function addDays(value, days) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
}
function dkParts(value) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Copenhagen",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}
function parseEbilletDateTime(value) {
  const raw = String(value ?? "").trim();
  if (/(?:Z|[+-]\d{2}:?\d{2})$/u.test(raw)) return dkParts(raw);
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/u);
  return match ? { date: match[1], time: match[2] } : null;
}

async function restAll({ baseUrl, key, table, select, filters = [], order }) {
  const out = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = new URL(`/rest/v1/${table}`, baseUrl);
    url.searchParams.set("select", select);
    for (const [name, value] of filters) url.searchParams.append(name, value);
    if (order) url.searchParams.set("order", order);
    const response = await fetch(url, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${offset}-${offset + PAGE_SIZE - 1}`,
        "Range-Unit": "items",
      },
    });
    if (!response.ok) throw new Error(`${table}: ${response.status} ${await response.text()}`);
    const page = await response.json();
    out.push(...page);
    if (page.length < PAGE_SIZE) return out;
  }
}

async function fetchUpstream(ids) {
  const combined = { organizers: [], movies: [], movieBases: [], showtimes: [], showtimeTypes: [] };
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const url = `${API_BASE}/movies?organizerIds=${chunk.join(",")}`;
    const response = await fetch(url, { headers: { "User-Agent": "KarlVictor", accept: "application/json" } });
    if (!response.ok) throw new Error(`eBillet ${response.status} for ${chunk.join(",")}`);
    const json = await response.json();
    for (const key of Object.keys(combined)) combined[key].push(...(json[key] ?? []));
  }
  return combined;
}

async function fetchPipelineHealth() {
  try {
    const response = await fetch(`${LANTERNA_BASE}/api/public/import-health`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    const body = await response.json().catch(() => null);
    return { httpStatus: response.status, body };
  } catch (error) {
    return { httpStatus: null, error: error instanceof Error ? error.message : String(error) };
  }
}

const normHall = (value) => String(value ?? "").trim().toLowerCase();
const keyOf = (source, movieId, cinemaId, date, hall) => [source, movieId, cinemaId, date, hall ?? ""].join("|");
const slotKey = (organizerId, date, time, hall) => [organizerId, date, time, normHall(hall)].join("|");

const start = dkDate();
const end = addDays(start, 30);
const { url, key } = await config();
const commonFilters = [["source", "eq.ebillet"]];

const [canonicalRows, legacyRows, cinemas, movies, pipelineHealth] = await Promise.all([
  restAll({ baseUrl: url, key, table: "screenings", select: "movie_id,cinema_id,local_date,local_time,hall", filters: [...commonFilters, ["local_date", `gte.${start}`], ["local_date", `lte.${end}`]], order: "local_date.asc" }),
  restAll({ baseUrl: url, key, table: "showtimes", select: "movie_id,cinema_id,date,hall,times", filters: [...commonFilters, ["date", `gte.${start}`], ["date", `lte.${end}`]], order: "date.asc" }),
  restAll({ baseUrl: url, key, table: "cinemas", select: "id,name,ebillet_organizer_id" }),
  restAll({ baseUrl: url, key, table: "movies", select: "id,title,ebillet_movie_base_id,ebillet_movie_ids" }),
  fetchPipelineHealth(),
]);

const canonical = new Map();
for (const row of canonicalRows) {
  const key = keyOf("ebillet", row.movie_id, row.cinema_id, row.local_date, row.hall);
  const set = canonical.get(key) ?? new Set();
  set.add(String(row.local_time).slice(0, 5));
  canonical.set(key, set);
}
const legacy = new Map();
for (const row of legacyRows) {
  const key = keyOf("ebillet", row.movie_id, row.cinema_id, row.date, row.hall);
  legacy.set(key, new Set((row.times ?? []).map((t) => String(t).slice(0, 5))));
}

const cinemaById = new Map(cinemas.map((row) => [row.id, row]));
const movieById = new Map(movies.map((row) => [row.id, row]));
const extraLegacy = [];
for (const [groupKey, times] of legacy) {
  const canonicalTimes = canonical.get(groupKey) ?? new Set();
  const [, movieId, cinemaId, date, hall] = groupKey.split("|");
  for (const time of times) {
    if (canonicalTimes.has(time)) continue;
    const cinema = cinemaById.get(cinemaId);
    extraLegacy.push({
      groupKey,
      movieId,
      cinemaId,
      cinemaName: cinema?.name ?? null,
      organizerId: cinema?.ebillet_organizer_id ?? null,
      movie: movieById.get(movieId) ?? null,
      date,
      time,
      hall,
    });
  }
}

const organizerIds = [...new Set(extraLegacy.map((x) => Number(x.organizerId)).filter((n) => Number.isFinite(n) && n > 0))];
const upstream = await fetchUpstream(organizerIds);
const upstreamSlots = new Map();
for (const showtime of upstream.showtimes) {
  const parts = parseEbilletDateTime(showtime.dateTime);
  if (!parts) continue;
  const key = slotKey(showtime.organizerId, parts.date, parts.time, showtime.locationName ?? "");
  const values = upstreamSlots.get(key) ?? [];
  values.push(showtime);
  upstreamSlots.set(key, values);
}

const classifications = extraLegacy.map((item) => {
  if (!item.organizerId) return { ...item, status: "no-organizer-mapping", upstream: [] };
  const exact = upstreamSlots.get(slotKey(item.organizerId, item.date, item.time, item.hall)) ?? [];
  const movie = item.movie;
  const matchingMovie = exact.filter((showtime) => {
    if (!movie) return true;
    if (movie.ebillet_movie_base_id && showtime.movieBaseId === movie.ebillet_movie_base_id) return true;
    return Array.isArray(movie.ebillet_movie_ids) && movie.ebillet_movie_ids.includes(showtime.movieId);
  });
  return {
    ...item,
    status: matchingMovie.length > 0 ? "still-upstream" : exact.length > 0 ? "upstream-slot-different-movie" : "stale-legacy",
    upstream: (matchingMovie.length > 0 ? matchingMovie : exact).map((s) => ({ id: s.id, movieId: s.movieId, movieBaseId: s.movieBaseId, dateTime: s.dateTime, locationName: s.locationName })),
  };
});

const counts = classifications.reduce((acc, row) => {
  acc[row.status] = (acc[row.status] ?? 0) + 1;
  return acc;
}, {});
console.log(JSON.stringify({
  window: { start, end },
  extraLegacyScreenings: classifications.length,
  organizersChecked: organizerIds.length,
  counts,
  canonicalPipelineHealth: pipelineHealth,
  examples: classifications.slice(0, 100),
}, null, 2));
