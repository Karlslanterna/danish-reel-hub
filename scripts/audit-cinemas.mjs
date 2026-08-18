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
  const text = await fs.readFile(
    new URL("../src/integrations/supabase/public-config.ts", import.meta.url),
    "utf8",
  );
  const url = text.match(/PUBLIC_SUPABASE_URL\s*=\s*["']([^"']+)/)?.[1];
  const key = text.match(/PUBLIC_SUPABASE_PUBLISHABLE_KEY\s*=\s*["']([^"']+)/)?.[1];
  if (!url || !key) throw new Error("Could not read public Supabase config");
  return { url, key };
}

async function loadKnownCinemaAliases() {
  const text = await fs.readFile(new URL("../src/lib/cinema-catalog.ts", import.meta.url), "utf8");
  return new Map(
    [...text.matchAll(/^\s*"([^"]+)":\s*"([^"]+)",?$/gm)].map((match) => [match[1], match[2]]),
  );
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
    if (page.length < PAGE_SIZE) return rows;
  }
}

const fold = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " og ")
    .replace(/[^a-z0-9æøå]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const baseCity = (value) =>
  String(value ?? "")
    .replace(/^\s*\d{3,4}\s+/u, "")
    .replace(/^(København|Odense|Aarhus|Aalborg|Randers)\s+[A-ZÆØÅ]{1,3}\.?$/u, "$1")
    .trim();

function distanceKm(a, b) {
  if (
    !Number.isFinite(a.latitude) ||
    !Number.isFinite(a.longitude) ||
    !Number.isFinite(b.latitude) ||
    !Number.isFinite(b.longitude)
  )
    return Number.POSITIVE_INFINITY;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(x));
}

function groupDuplicates(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({ key, cinemas: group.map(cinemaSummary) }))
    .sort((a, b) => b.cinemas.length - a.cinemas.length || a.key.localeCompare(b.key, "da"));
}

function validWebsite(value) {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function validCoordinate(latitude, longitude) {
  if (latitude == null && longitude == null) return true;
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function cinemaSummary(cinema) {
  return {
    id: cinema.id,
    slug: cinema.slug,
    name: cinema.name,
    city: cinema.city,
    address: cinema.address,
    source: cinema.source,
    organizer: cinema.ebillet_organizer_id,
    website: cinema.website,
    latitude: cinema.latitude,
    longitude: cinema.longitude,
  };
}

function printSection(title, rows, limit = 100) {
  console.log(`\n=== ${title} (${rows.length}) ===`);
  for (const row of rows.slice(0, limit)) console.log(JSON.stringify(row));
  if (rows.length > limit) console.log(`... ${rows.length - limit} more`);
}

function tokenSimilarity(left, right) {
  const a = new Set(fold(left).split(" ").filter(Boolean));
  const b = new Set(fold(right).split(" ").filter(Boolean));
  if (a.size === 0 || b.size === 0) return 0;
  const overlap = [...a].filter((token) => b.has(token)).length;
  return overlap / new Set([...a, ...b]).size;
}

const start = copenhagenDate();
const end = addDays(start, WINDOW_DAYS);
const { url, key } = await loadPublicConfig();
const knownAliases = await loadKnownCinemaAliases();
const canonicalId = (id) => knownAliases.get(id) ?? id;

const [cinemas, screenings] = await Promise.all([
  fetchPages({
    baseUrl: url,
    key,
    table: "cinemas",
    select:
      "id,slug,name,city,address,description,screens,latitude,longitude,website,external_id,source,ebillet_organizer_id",
    configure: (requestUrl) => requestUrl.searchParams.set("order", "name.asc,city.asc"),
  }),
  fetchPages({
    baseUrl: url,
    key,
    table: "screenings",
    select: "cinema_id,source,local_date,local_time,ticket_url",
    configure: (requestUrl) => {
      requestUrl.searchParams.set("local_date", `gte.${start}`);
      requestUrl.searchParams.append("local_date", `lte.${end}`);
      requestUrl.searchParams.set("order", "local_date.asc,local_time.asc");
    },
  }),
]);

const cinemaById = new Map(cinemas.map((cinema) => [cinema.id, cinema]));
const screeningsByCinema = new Map();
for (const screening of screenings) {
  const list = screeningsByCinema.get(screening.cinema_id) ?? [];
  list.push(screening);
  screeningsByCinema.set(screening.cinema_id, list);
}

const blankRequired = cinemas.filter(
  (cinema) =>
    !String(cinema.id ?? "").trim() ||
    !String(cinema.slug ?? "").trim() ||
    !String(cinema.name ?? "").trim() ||
    !String(cinema.city ?? "").trim(),
);
const invalidWebsites = cinemas.filter((cinema) => !validWebsite(cinema.website));
const invalidCoordinates = cinemas.filter(
  (cinema) => !validCoordinate(cinema.latitude, cinema.longitude),
);
const partialCoordinates = cinemas.filter(
  (cinema) => (cinema.latitude == null) !== (cinema.longitude == null),
);
const missingLocation = cinemas.filter(
  (cinema) =>
    !String(cinema.address ?? "").trim() && cinema.latitude == null && cinema.longitude == null,
);
const invalidSourceOwnership = cinemas.filter(
  (cinema) => cinema.ebillet_organizer_id != null && cinema.source !== "ebillet",
);
const duplicateSlugs = groupDuplicates(cinemas, (cinema) => String(cinema.slug ?? "").trim());
const duplicateNameCity = groupDuplicates(
  cinemas,
  (cinema) => `${fold(cinema.name)}|${fold(baseCity(cinema.city))}`,
);
const duplicateAddressCity = groupDuplicates(cinemas, (cinema) => {
  const address = fold(cinema.address);
  return address ? `${address}|${fold(baseCity(cinema.city))}` : "";
});
const nearbyCinemaPairs = [];
for (let left = 0; left < cinemas.length; left += 1) {
  for (let right = left + 1; right < cinemas.length; right += 1) {
    const a = cinemas[left];
    const b = cinemas[right];
    if (fold(baseCity(a.city)) !== fold(baseCity(b.city))) continue;
    const distance = distanceKm(a, b);
    if (distance > 0.2) continue;
    nearbyCinemaPairs.push({
      distanceMeters: Math.round(distance * 1000),
      cinemas: [cinemaSummary(a), cinemaSummary(b)],
    });
  }
}
nearbyCinemaPairs.sort((a, b) => a.distanceMeters - b.distanceMeters);
const directEbilletMatches = cinemas
  .filter((cinema) => String(cinema.id).startsWith("eb-"))
  .map((cinema) => {
    const city = fold(baseCity(cinema.city));
    const address = fold(cinema.address);
    const candidates = cinemas
      .filter(
        (candidate) =>
          candidate.id !== cinema.id &&
          !String(candidate.id).startsWith("eb-") &&
          fold(baseCity(candidate.city)) === city,
      )
      .map((candidate) => {
        const candidateAddress = fold(candidate.address);
        const addressMatch =
          address && candidateAddress
            ? address === candidateAddress
              ? 1
              : address.includes(candidateAddress) || candidateAddress.includes(address)
                ? 0.85
                : tokenSimilarity(address, candidateAddress)
            : 0;
        const nameMatch = tokenSimilarity(cinema.name, candidate.name);
        return {
          score: Number((addressMatch * 0.7 + nameMatch * 0.3).toFixed(3)),
          cinema: cinemaSummary(candidate),
        };
      })
      .filter((candidate) => candidate.score >= 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    return { cinema: cinemaSummary(cinema), candidates };
  });
const duplicateGroupIsKnown = (group) =>
  new Set(group.cinemas.map((cinema) => canonicalId(cinema.id))).size === 1;
const unmappedDuplicateNameCity = duplicateNameCity.filter(
  (group) => !duplicateGroupIsKnown(group),
);
const unmappedDuplicateAddressCity = duplicateAddressCity.filter(
  (group) => !duplicateGroupIsKnown(group),
);
const unmappedLikelyDirectMatches = directEbilletMatches.filter(
  ({ cinema, candidates }) => !knownAliases.has(cinema.id) && (candidates[0]?.score ?? 0) >= 0.6,
);
const activeCinemas = cinemas.filter((cinema) => screeningsByCinema.has(cinema.id));
const cinemasWithoutScreenings = cinemas.filter((cinema) => !screeningsByCinema.has(cinema.id));
const orphanScreenings = screenings.filter((screening) => !cinemaById.has(screening.cinema_id));
const sourceViolations = screenings.filter((screening) => {
  const cinema = cinemaById.get(screening.cinema_id);
  if (!cinema) return false;
  const expected = cinema.ebillet_organizer_id != null ? "ebillet" : "kultunaut";
  return screening.source !== expected;
});
const malformedScheduleData = screenings.filter(
  (screening) =>
    !/^\d{4}-\d{2}-\d{2}$/.test(String(screening.local_date ?? "")) ||
    !/^\d{2}:\d{2}(?::\d{2})?$/.test(String(screening.local_time ?? "")),
);
const unsafeTicketUrls = screenings.filter(
  (screening) => screening.ticket_url && !validWebsite(screening.ticket_url),
);

const counts = activeCinemas
  .map((cinema) => ({
    ...cinemaSummary(cinema),
    screenings: screeningsByCinema.get(cinema.id)?.length ?? 0,
  }))
  .sort((a, b) => b.screenings - a.screenings || a.name.localeCompare(b.name, "da"));

console.log("CINEMA AUDIT");
console.log(
  JSON.stringify(
    {
      window: { start, end },
      cinemas: cinemas.length,
      publicCinemas: cinemas.length - knownAliases.size,
      knownSourceAliases: knownAliases.size,
      activeCinemas: activeCinemas.length,
      cinemasWithoutScreenings: cinemasWithoutScreenings.length,
      screenings: screenings.length,
      screeningSources: Object.fromEntries(
        [...new Set(screenings.map((screening) => screening.source))]
          .sort()
          .map((source) => [source, screenings.filter((row) => row.source === source).length]),
      ),
    },
    null,
    2,
  ),
);

printSection("Blank required cinema fields", blankRequired.map(cinemaSummary));
printSection("Invalid cinema website URLs", invalidWebsites.map(cinemaSummary));
printSection("Invalid cinema coordinates", invalidCoordinates.map(cinemaSummary));
printSection("Partial cinema coordinate pairs", partialCoordinates.map(cinemaSummary));
printSection("Cinemas without address or coordinates", missingLocation.map(cinemaSummary));
printSection("eBillet ownership/source mismatches", invalidSourceOwnership.map(cinemaSummary));
printSection(
  "Direct eBillet cinema rows",
  cinemas.filter((cinema) => String(cinema.id).startsWith("eb-")).map(cinemaSummary),
);
printSection("Likely Kultunaut matches for direct eBillet rows", directEbilletMatches);
printSection("Duplicate cinema slugs", duplicateSlugs);
printSection("Duplicate normalized cinema name + city", duplicateNameCity);
printSection("Duplicate normalized cinema address + city", duplicateAddressCity);
printSection("Unmapped duplicate cinema name + city", unmappedDuplicateNameCity);
printSection("Unmapped duplicate cinema address + city", unmappedDuplicateAddressCity);
printSection("Unmapped likely direct eBillet matches", unmappedLikelyDirectMatches);
printSection("Cinema pairs within 200 m in the same city", nearbyCinemaPairs);
printSection(
  "Visible cinemas without current screenings",
  cinemasWithoutScreenings.map(cinemaSummary),
);
printSection("Active screenings with unknown cinema", orphanScreenings);
printSection("Screening/cinema source authority violations", sourceViolations);
printSection("Malformed screening schedule data", malformedScheduleData);
printSection("Unsafe upstream ticket URLs (suppressed publicly)", unsafeTicketUrls);
printSection("Active cinemas by screening count", counts);

const issues = {
  blankRequired: blankRequired.length,
  invalidWebsites: invalidWebsites.length,
  invalidCoordinates: invalidCoordinates.length,
  partialCoordinates: partialCoordinates.length,
  missingLocation: missingLocation.length,
  invalidSourceOwnership: invalidSourceOwnership.length,
  duplicateSlugs: duplicateSlugs.length,
  unmappedDuplicateNameCity: unmappedDuplicateNameCity.length,
  unmappedDuplicateAddressCity: unmappedDuplicateAddressCity.length,
  unmappedLikelyDirectMatches: unmappedLikelyDirectMatches.length,
  orphanScreenings: orphanScreenings.length,
  sourceViolations: sourceViolations.length,
  malformedScheduleData: malformedScheduleData.length,
};

console.log("\nAUDIT SUMMARY");
console.log(JSON.stringify(issues, null, 2));
console.log(
  JSON.stringify(
    { warnings: { unsafeUpstreamTicketUrlsSuppressedPublicly: unsafeTicketUrls.length } },
    null,
    2,
  ),
);
if (Object.values(issues).some((count) => count > 0)) process.exitCode = 1;
