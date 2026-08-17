import fs from "node:fs/promises";

const PAGE_SIZE = 1000;
const WINDOW_DAYS = 30;
const MIN_KULTUNAUT_HORIZON_DAYS = 21;

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

function daysBetween(start, end) {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  return Math.round(
    (Date.UTC(ey, em - 1, ed, 12) - Date.UTC(sy, sm - 1, sd, 12)) / 86_400_000,
  );
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

async function fetchWindow({ baseUrl, key, table, select, dateColumn, start, end }) {
  return fetchPages({
    baseUrl,
    key,
    table,
    select,
    configure: (url) => {
      url.searchParams.set(dateColumn, `gte.${start}`);
      url.searchParams.append(dateColumn, `lte.${end}`);
      url.searchParams.set("order", `${dateColumn}.asc`);
    },
  });
}

const normTime = (value) => String(value ?? "").slice(0, 5);
const normUrl = (value) => String(value ?? "").trim();
const groupKey = (row, dateField) =>
  [row.source, row.movie_id, row.cinema_id, row[dateField], row.hall ?? ""].join("|");

function canonicalGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = groupKey(row, "local_date");
    const group = groups.get(key) ?? { key, slots: [] };
    group.slots.push({
      startsAt: row.starts_at,
      time: normTime(row.local_time),
      ticketUrl: normUrl(row.ticket_url),
    });
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }
  return groups;
}

function legacyGroups(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = groupKey(row, "date");
    if (groups.has(key)) throw new Error(`Duplicate legacy grouped key: ${key}`);
    const times = Array.isArray(row.times) ? row.times.map(normTime) : [];
    const urls = Array.isArray(row.ticket_urls)
      ? row.ticket_urls.map(normUrl)
      : times.map((_, index) => (index === 0 ? normUrl(row.ticket_url) : ""));
    groups.set(key, {
      key,
      slots: times.map((time, index) => ({ time, ticketUrl: urls[index] ?? "" })),
    });
  }
  return groups;
}

function sourceCounts(groups) {
  const counts = {};
  for (const group of groups.values()) {
    const source = group.key.split("|", 1)[0];
    counts[source] ??= { groups: 0, screenings: 0 };
    counts[source].groups += 1;
    counts[source].screenings += group.slots.length;
  }
  return counts;
}

function compare(canonical, legacy) {
  const mismatches = [];
  for (const key of new Set([...canonical.keys(), ...legacy.keys()])) {
    const current = canonical.get(key);
    const old = legacy.get(key);
    if (!current || !old) {
      mismatches.push({ key, reason: !current ? "missing-canonical" : "missing-legacy" });
      continue;
    }
    const currentTimes = current.slots.map((slot) => slot.time);
    const oldTimes = old.slots.map((slot) => slot.time);
    if (JSON.stringify(currentTimes) !== JSON.stringify(oldTimes)) {
      mismatches.push({ key, reason: "times", canonical: currentTimes, legacy: oldTimes });
      continue;
    }
    const currentUrls = current.slots.map((slot) => slot.ticketUrl);
    const oldUrls = old.slots.map((slot) => slot.ticketUrl);
    if (JSON.stringify(currentUrls) !== JSON.stringify(oldUrls)) {
      mismatches.push({ key, reason: "ticket-urls", canonical: currentUrls, legacy: oldUrls });
    }
  }
  return mismatches;
}

const start = copenhagenDate();
const end = addDays(start, WINDOW_DAYS);
const { url, key } = await loadPublicConfig();

const [screenings, showtimes, cinemas] = await Promise.all([
  fetchWindow({
    baseUrl: url,
    key,
    table: "screenings",
    select: "source,movie_id,cinema_id,local_date,local_time,hall,ticket_url,starts_at",
    dateColumn: "local_date",
    start,
    end,
  }),
  fetchWindow({
    baseUrl: url,
    key,
    table: "showtimes",
    select: "source,movie_id,cinema_id,date,hall,times,ticket_url,ticket_urls",
    dateColumn: "date",
    start,
    end,
  }),
  fetchPages({
    baseUrl: url,
    key,
    table: "cinemas",
    select: "id,slug,ebillet_organizer_id",
  }),
]);

const canonical = canonicalGroups(screenings);
const legacy = legacyGroups(showtimes);
const mismatches = compare(canonical, legacy);

const ebilletOwnedCinemaIds = new Set(
  cinemas.filter((cinema) => cinema.ebillet_organizer_id != null).map((cinema) => cinema.id),
);
const authorityViolations = screenings.filter(
  (screening) =>
    screening.source === "kultunaut" && ebilletOwnedCinemaIds.has(screening.cinema_id),
);
const kultunautDates = screenings
  .filter((screening) => screening.source === "kultunaut")
  .map((screening) => screening.local_date)
  .sort();
const kultunautLastDate = kultunautDates.at(-1) ?? null;
const kultunautHorizonDays = kultunautLastDate ? daysBetween(start, kultunautLastDate) : 0;
const kultunautCoverageOk =
  kultunautDates.length > 0 && kultunautHorizonDays >= MIN_KULTUNAUT_HORIZON_DAYS;

console.log(
  JSON.stringify(
    {
      window: { start, end },
      canonical: sourceCounts(canonical),
      legacy: sourceCounts(legacy),
      mismatchCount: mismatches.length,
      mismatches: mismatches.slice(0, 25),
      kultunaut: {
        lastDate: kultunautLastDate,
        horizonDays: kultunautHorizonDays,
        minimumHorizonDays: MIN_KULTUNAUT_HORIZON_DAYS,
        coverageOk: kultunautCoverageOk,
        authorityViolationCount: authorityViolations.length,
        authorityViolations: authorityViolations.slice(0, 10).map((row) => ({
          cinemaId: row.cinema_id,
          movieId: row.movie_id,
          date: row.local_date,
          time: row.local_time,
        })),
      },
    },
    null,
    2,
  ),
);

if (mismatches.length > 0 || authorityViolations.length > 0 || !kultunautCoverageOk) {
  process.exit(1);
}
