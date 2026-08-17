import fs from "node:fs/promises";

const PAGE_SIZE = 1000;
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
  const text = await fs.readFile(new URL("../src/integrations/supabase/public-config.ts", import.meta.url), "utf8");
  const url = text.match(/PUBLIC_SUPABASE_URL\s*=\s*["']([^"']+)/)?.[1];
  const key = text.match(/PUBLIC_SUPABASE_PUBLISHABLE_KEY\s*=\s*["']([^"']+)/)?.[1];
  if (!url || !key) throw new Error("Could not read public Supabase config");
  return { baseUrl: url, key };
}

async function rest({ baseUrl, key, table, params = {}, range = null }) {
  const url = new URL(`/rest/v1/${table}`, baseUrl);
  for (const [name, value] of Object.entries(params)) {
    if (Array.isArray(value)) for (const item of value) url.searchParams.append(name, item);
    else if (value != null) url.searchParams.set(name, value);
  }
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  if (range) {
    headers.Range = `${range.from}-${range.to}`;
    headers["Range-Unit"] = "items";
  }
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${table} fetch failed (${response.status}): ${await response.text()}`);
  return response.json();
}

async function paged(args) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const page = await rest({ ...args, range: { from, to: from + PAGE_SIZE - 1 } });
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

const clean = (value) => String(value ?? "").trim();
const time5 = (value) => clean(value).slice(0, 5);
const eBilletMovieKey = (showtime) => Number(showtime.movieBaseId ?? 0) > 0 ? `base-${Number(showtime.movieBaseId)}` : `movie-${showtime.movieId}`;

function canonicalMovieKeys(movie) {
  const keys = new Set();
  if (Number(movie?.ebillet_movie_base_id ?? 0) > 0) keys.add(`base-${Number(movie.ebillet_movie_base_id)}`);
  for (const id of movie?.ebillet_movie_ids ?? []) keys.add(`movie-${Number(id)}`);
  return keys;
}

function upstreamPhysicalKey(showtime) {
  const localDate = clean(showtime.dateTime).slice(0, 10);
  const localTime = clean(showtime.dateTime).slice(11, 16);
  const hall = clean(showtime.locationName) || "Sal";
  return `${eBilletMovieKey(showtime)}|${localDate}|${localTime}|${hall}`;
}

function canonicalPhysicalKeys(screening, movie) {
  const hall = clean(screening.hall) || "Sal";
  const suffix = `${screening.local_date}|${time5(screening.local_time)}|${hall}`;
  return [...canonicalMovieKeys(movie)].map((movieKey) => `${movieKey}|${suffix}`);
}

function normalizeFranchiseTitle(title) {
  return clean(title)
    .toLocaleLowerCase("da")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+i\s+70\s*mm\b.*$/iu, "")
    .replace(/\s*:\s*for\s+b-mennesker\b.*$/iu, "")
    .replace(/\s*[-–—]\s*(?:70\s*mm|imax|3d|2d)\b.*$/iu, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function auditEmpire(config, start, end) {
  let cinemas = await rest({ ...config, table: "cinemas", params: { select: "id,slug,name,city,ebillet_organizer_id", slug: "eq.empire-bio", limit: "5" } });
  if (cinemas.length === 0) cinemas = await rest({ ...config, table: "cinemas", params: { select: "id,slug,name,city,ebillet_organizer_id", name: "ilike.*Empire*", limit: "20" } });
  const cinema = cinemas.find((row) => /empire/i.test(row.name)) ?? cinemas[0];
  if (!cinema) throw new Error("Empire Bio not found in production cinemas");
  if (!cinema.ebillet_organizer_id) throw new Error("Empire Bio has no eBillet organizer id");

  const screenings = await paged({ ...config, table: "screenings", params: { select: "id,source,source_ref,movie_id,starts_at,local_date,local_time,hall,ticket_url,updated_at", cinema_id: `eq.${cinema.id}`, source: "eq.ebillet", local_date: [`gte.${start}`, `lte.${end}`], order: "starts_at.asc" } });
  const movieIds = [...new Set(screenings.map((row) => row.movie_id))];
  const movies = movieIds.length ? await rest({ ...config, table: "movies", params: { select: "id,title,slug,ebillet_movie_base_id,ebillet_movie_ids,tmdb_id", id: `in.(${movieIds.join(",")})` } }) : [];
  const movieById = new Map(movies.map((movie) => [movie.id, movie]));

  const apiUrl = new URL("https://flow.ebillet.dk/api/movies");
  apiUrl.searchParams.set("organizerIds", String(cinema.ebillet_organizer_id));
  const upstreamResponse = await fetch(apiUrl, { headers: { "User-Agent": "KarlVictor", accept: "application/json" } });
  if (!upstreamResponse.ok) throw new Error(`Empire eBillet upstream failed (${upstreamResponse.status})`);
  const upstream = await upstreamResponse.json();
  const upstreamRows = (upstream.showtimes ?? []).filter((row) => Number(row.organizerId) === Number(cinema.ebillet_organizer_id) && clean(row.dateTime).slice(0, 10) >= start && clean(row.dateTime).slice(0, 10) <= end);

  const upstreamKeys = new Set(upstreamRows.map(upstreamPhysicalKey));
  const canonicalKeys = new Set();
  const staleCanonical = [];
  for (const screening of screenings) {
    const movie = movieById.get(screening.movie_id);
    const keys = canonicalPhysicalKeys(screening, movie);
    for (const key of keys) canonicalKeys.add(key);
    if (!keys.some((key) => upstreamKeys.has(key))) staleCanonical.push({ id: screening.id, sourceRef: screening.source_ref, movieId: screening.movie_id, title: movie?.title ?? null, date: screening.local_date, time: time5(screening.local_time), hall: screening.hall, ticketUrl: screening.ticket_url, updatedAt: screening.updated_at, candidateKeys: keys });
  }

  const missingCanonical = upstreamRows.filter((row) => !canonicalKeys.has(upstreamPhysicalKey(row))).map((row) => ({ id: row.id, movieId: row.movieId, movieBaseId: row.movieBaseId, dateTime: row.dateTime, hall: row.locationName, buyEnabled: row.buyInfo?.enabled ?? null, key: upstreamPhysicalKey(row) }));
  return { cinema, canonicalCount: screenings.length, upstreamCount: upstreamRows.length, staleCanonicalCount: staleCanonical.length, staleCanonical: staleCanonical.slice(0, 100), missingCanonicalCount: missingCanonical.length, missingCanonical: missingCanonical.slice(0, 100) };
}

async function auditOdyssey(config, start, end) {
  const movies = await rest({ ...config, table: "movies", params: { select: "id,slug,title,original_title,source,year,release_date,external_id,ebillet_movie_base_id,ebillet_movie_ids,tmdb_id,tmdb_status,created_at", title: "ilike.*Odyssey*", order: "title.asc", limit: "100" } });
  if (movies.length === 0) return { movies: [], groups: [] };
  const ids = movies.map((movie) => movie.id);
  const screenings = await paged({ ...config, table: "screenings", params: { select: "movie_id,source,cinema_id,local_date,local_time,hall,events,formats", movie_id: `in.(${ids.join(",")})`, local_date: [`gte.${start}`, `lte.${end}`], order: "local_date.asc" } });
  const stats = new Map(movies.map((movie) => [movie.id, { screenings: 0, cinemas: new Set(), sources: new Set(), eventLabels: new Set(), formats: new Set(), firstDate: null, lastDate: null }]));
  for (const row of screenings) {
    const stat = stats.get(row.movie_id);
    if (!stat) continue;
    stat.screenings += 1;
    stat.cinemas.add(row.cinema_id);
    stat.sources.add(row.source);
    for (const event of row.events ?? []) stat.eventLabels.add(event);
    for (const format of row.formats ?? []) stat.formats.add(format);
    if (!stat.firstDate || row.local_date < stat.firstDate) stat.firstDate = row.local_date;
    if (!stat.lastDate || row.local_date > stat.lastDate) stat.lastDate = row.local_date;
  }
  const enriched = movies.map((movie) => {
    const stat = stats.get(movie.id);
    return { ...movie, normalizedTitle: normalizeFranchiseTitle(movie.title), screeningCount: stat?.screenings ?? 0, cinemaCount: stat?.cinemas.size ?? 0, screeningSources: [...(stat?.sources ?? [])], eventLabels: [...(stat?.eventLabels ?? [])], formats: [...(stat?.formats ?? [])], firstDate: stat?.firstDate ?? null, lastDate: stat?.lastDate ?? null };
  });
  const grouped = new Map();
  for (const movie of enriched) {
    const key = movie.tmdb_id ? `tmdb:${movie.tmdb_id}` : `title:${movie.normalizedTitle}|year:${movie.year}`;
    const group = grouped.get(key) ?? [];
    group.push(movie);
    grouped.set(key, group);
  }
  return { movies: enriched, groups: [...grouped.entries()].map(([key, rows]) => ({ key, count: rows.length, ids: rows.map((row) => row.id), titles: rows.map((row) => row.title), tmdbIds: [...new Set(rows.map((row) => row.tmdb_id).filter(Boolean))], screeningCount: rows.reduce((sum, row) => sum + row.screeningCount, 0) })) };
}

const start = copenhagenDate();
const end = addDays(start, WINDOW_DAYS);
const config = await loadPublicConfig();
const [empire, odyssey] = await Promise.all([auditEmpire(config, start, end), auditOdyssey(config, start, end)]);
console.log(JSON.stringify({ window: { start, end }, empire, odyssey }, null, 2));
