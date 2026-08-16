/**
 * eBillet discovery + sync.
 *
 * Design notes
 * ------------
 * - Kultunaut stays the primary source. eBillet only *supplements*: it fills
 *   empty fields on matched movies and adds cinemas/showtimes Kultunaut does
 *   not cover. It never overwrites non-empty Kultunaut values.
 * - Discovery: eBillet has no organizer directory endpoint, so we probe the
 *   organizer id space in small batches against /api/movies?organizerIds=...
 *   (unknown ids are silently ignored). Everything found is registered in
 *   `ebillet_organizers`; the ones that actually have screenings are marked
 *   active — this is what the public "biografer online" list reflects.
 * - Both discovery and sync are resumable: a row in `ebillet_sync_runs` keeps
 *   a cursor so a run can be drained across several invocations inside the
 *   serverless wall-clock budget.
 * - Idempotent: rows are keyed by stable eBillet ids
 *   (organizerId / movieBaseId / movieId / showtimeId).
 */

import {
  ebilletBookingUrl,
  fetchOrganizerPayload,
  parseRuntimeMinutes,
  type EbilletMoviesResponse,
} from "./api.server";
import { classifyOrganizer } from "./venue-filter";
import { matchCinema, uniqueCinemaSlug } from "./cinema-match";

export const DEFAULT_MAX_ORGANIZER_ID = 400;
const DISCOVERY_BATCH = 10;
const WALL_CLOCK_BUDGET_MS = 100_000;

export type OrganizerSyncCounts = {
  cinemas: number;
  movies: number;
  showtimes: number;
};

export type SyncRunSummary = {
  runId: string;
  kind: "discover" | "sync";
  status: "running" | "completed" | "failed";
  organizersFound: number;
  organizersActive: number;
  organizersSynced: number;
  organizersFailed: number;
  cinemas: number;
  movies: number;
  showtimes: number;
  errors: string[];
  message: string | null;
  done: boolean;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function log(event: string, ctx: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ level: "info", scope: "ebillet", event, ...ctx }));
}
function logError(event: string, ctx: Record<string, unknown> = {}) {
  console.error(JSON.stringify({ level: "error", scope: "ebillet", event, ...ctx }));
}

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[æø]/g, (c) => (c === "æ" ? "ae" : "oe"))
    .replace(/å/g, "aa")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";

const stripYearSuffix = (title: string): string =>
  title.replace(/\s*[([]\s*(?:19|20)\d{2}\s*[)\]]\s*$/u, "").trim();

/** Normalised comparison key for safe title/name matching. */
const normKey = (value: string): string => slugify(stripYearSuffix(value));

const isBlank = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === "string" && v.trim() === "");

// ---------------------------------------------------------------- discovery

export type DiscoveredOrganizer = {
  id: number;
  name: string;
  city: string | null;
  zip: string | null;
  address: string | null;
  region: string | null;
  locationCount: number;
  showtimeCount: number;
};

function extractOrganizers(payload: EbilletMoviesResponse): DiscoveredOrganizer[] {
  return payload.organizers.map((o) => ({
    id: o.id,
    name: o.name,
    city: o.address?.city ?? null,
    zip: o.address?.zip ?? null,
    address: o.address?.roadAndNumber ?? null,
    region: o.address?.region ?? null,
    locationCount: o.locations?.length ?? 0,
    showtimeCount: payload.showtimes.filter((s) => s.organizerId === o.id).length,
  }));
}

/**
 * Probe the organizer id space and register everything eBillet returns.
 * Resumable through `fromId`; returns the next id to continue from
 * (null when the whole range has been scanned).
 */
export async function discoverOrganizers(opts: {
  fromId?: number;
  maxId?: number;
  budgetMs?: number;
}): Promise<{
  nextId: number | null;
  found: DiscoveredOrganizer[];
  errors: string[];
}> {
  const db = await admin();
  const maxId = opts.maxId ?? DEFAULT_MAX_ORGANIZER_ID;
  const budgetMs = opts.budgetMs ?? WALL_CLOCK_BUDGET_MS;
  const startedAt = Date.now();
  let cursor = Math.max(1, opts.fromId ?? 1);

  const found: DiscoveredOrganizer[] = [];
  const errors: string[] = [];

  while (cursor <= maxId) {
    if (Date.now() - startedAt > budgetMs) {
      return { nextId: cursor, found, errors };
    }
    const ids: number[] = [];
    for (let i = cursor; i < Math.min(cursor + DISCOVERY_BATCH, maxId + 1); i++) ids.push(i);
    try {
      const payload = await fetchOrganizerPayload(ids);
      const organizers = extractOrganizers(payload);
      if (organizers.length > 0) {
        const rows = organizers.map((o) => ({
          id: o.id,
          name: o.name,
          city: o.city,
          zip: o.zip,
          address: o.address,
          region: o.region,
          location_count: o.locationCount,
          showtime_count: o.showtimeCount,
          is_active: o.showtimeCount > 0 && classifyOrganizer(o).isCinema,
        }));
        const { error } = await db.from("ebillet_organizers").upsert(rows, { onConflict: "id" });
        if (error) errors.push(`register ${ids[0]}-${ids[ids.length - 1]}: ${error.message}`);
        found.push(...organizers);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`discover ${ids[0]}-${ids[ids.length - 1]}: ${message}`);
      logError("discover_batch_failed", { from: ids[0], to: ids[ids.length - 1], message });
    }
    cursor += DISCOVERY_BATCH;
  }

  return { nextId: null, found, errors };
}

// ------------------------------------------------------------------- lookup

type CinemaRow = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  ebillet_organizer_id: number | null;
};

type MovieRow = {
  id: string;
  title: string;
  year: number | null;
  runtime: number | null;
  synopsis: string | null;
  director: string | null;
  genre: string[] | null;
  poster: Record<string, unknown> | null;
  trailer_url: string | null;
  ebillet_movie_base_id: number | null;
  ebillet_movie_ids: number[] | null;
};

async function loadAll<T>(
  db: any,
  table: string,
  columns: string,
): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

const CINEMA_COLUMNS = "id, name, slug, city, ebillet_organizer_id";

const dedupeById = <T extends { id: string | number }>(rows: T[]): T[] => {
  const map = new Map<string | number, T>();
  for (const row of rows) if (!map.has(row.id)) map.set(row.id, row);
  return [...map.values()];
};

/**
 * Only the cinemas that could plausibly match this organizer — loading the
 * whole table once per organizer does not scale.
 */
async function loadCinemaCandidates(
  db: any,
  org: { id: number; name: string; city: string },
): Promise<CinemaRow[]> {
  const bareCity = org.city.replace(/^\s*(?:DK[-\s]?)?\d{3,4}\b/iu, "").trim();
  const base = slugify(org.name);
  const slugs = [
    base,
    slugify(`${org.name} ${bareCity}`),
    bareCity ? `${base}-${slugify(bareCity)}` : base,
    `${base}-${org.id}`,
  ];
  const firstToken = org.name.trim().split(/\s+/)[0] ?? org.name;

  const [byOrg, bySlug, byName] = await Promise.all([
    db.from("cinemas").select(CINEMA_COLUMNS).eq("ebillet_organizer_id", org.id),
    db.from("cinemas").select(CINEMA_COLUMNS).in("slug", [...new Set(slugs)]),
    db.from("cinemas").select(CINEMA_COLUMNS).ilike("name", `${firstToken}%`).limit(50),
  ]);
  for (const res of [byOrg, bySlug, byName]) {
    if (res.error) throw new Error(`cinemas: ${res.error.message}`);
  }
  return dedupeById<CinemaRow>([
    ...(byOrg.data ?? []),
    ...(bySlug.data ?? []),
    ...(byName.data ?? []),
  ]);
}

const MOVIE_COLUMNS =
  "id, title, year, runtime, synopsis, director, genre, poster, trailer_url, ebillet_movie_base_id, ebillet_movie_ids";

/** Targeted movie lookup: only rows that could match this payload. */
async function loadMovieCandidates(
  db: any,
  baseIds: number[],
  movieIds: number[],
  titles: string[],
): Promise<MovieRow[]> {
  const queries: Array<Promise<{ data: MovieRow[] | null; error: { message: string } | null }>> = [];
  if (baseIds.length > 0) {
    queries.push(db.from("movies").select(MOVIE_COLUMNS).in("ebillet_movie_base_id", baseIds));
  }
  if (movieIds.length > 0) {
    queries.push(db.from("movies").select(MOVIE_COLUMNS).overlaps("ebillet_movie_ids", movieIds));
  }
  if (titles.length > 0) {
    queries.push(db.from("movies").select(MOVIE_COLUMNS).in("title", titles));
  }
  const results = await Promise.all(queries);
  const rows: MovieRow[] = [];
  for (const res of results) {
    if (res.error) throw new Error(`movies: ${res.error.message}`);
    rows.push(...(res.data ?? []));
  }
  return dedupeById(rows);
}


// --------------------------------------------------------------------- sync

/**
 * Import one eBillet organizer: its cinema, movies and screenings.
 * Safe to call repeatedly — everything is matched on stable ids first,
 * then on normalised names/titles.
 */
export async function syncOrganizer(organizerId: number): Promise<OrganizerSyncCounts> {
  const db = await admin();
  const payload = await fetchOrganizerPayload([organizerId]);
  const organizer = payload.organizers.find((o) => o.id === organizerId);
  if (!organizer) throw new Error(`Organizer ${organizerId} findes ikke hos eBillet`);

  // Only actual cinemas may enter Lanterna. Non-cinema venues (museums,
  // planetariums, …) are deactivated here so they are never created as
  // cinemas and are skipped by later syncs. See ./venue-filter.
  const classification = classifyOrganizer({ id: organizerId, name: organizer.name });
  if (!classification.isCinema) {
    await db
      .from("ebillet_organizers")
      .update({
        is_active: false,
        last_synced_at: new Date().toISOString(),
        last_sync_status: "skipped",
        last_sync_error: classification.reason,
      })
      .eq("id", organizerId);
    log("organizer_skipped", { organizerId, reason: classification.reason });
    return { cinemas: 0, movies: 0, showtimes: 0 };
  }

  const counts: OrganizerSyncCounts = { cinemas: 0, movies: 0, showtimes: 0 };

  // ---- 1. Cinema ---------------------------------------------------------
  const cinemas = await loadAll<CinemaRow>(
    db,
    "cinemas",
    "id, name, slug, city, ebillet_organizer_id",
  );
  const orgCity = organizer.address?.city ?? "";
  const matchInput = { id: organizerId, name: organizer.name, city: orgCity };
  // Reuse the existing (Kultunaut) cinema for the same physical venue whenever
  // we can identify it; only create a new row for genuinely new venues.
  const existingCinema = matchCinema(matchInput, cinemas);
  const cinemaId = existingCinema?.id ?? `eb-${organizerId}`;

  const cinemaPatch = {
    ebillet_organizer_id: organizerId,
    screens: Math.max(organizer.locations?.length ?? 1, 1),
  };
  if (existingCinema) {
    const { error } = await db.from("cinemas").update(cinemaPatch as any).eq("id", cinemaId);
    if (error) throw new Error(`cinema update ${cinemaId}: ${error.message}`);
  } else {
    // cinemas.slug is unique — always insert a slug that is provably free, and
    // retry once against a live re-read if a concurrent run took it meanwhile.
    let slug = uniqueCinemaSlug(matchInput, cinemas, cinemaId);
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = await db.from("cinemas").upsert(
        {
          id: cinemaId,
          slug,
          name: organizer.name,
          city: orgCity || "Danmark",
          address: organizer.address?.roadAndNumber ?? "",
          description: "",
          source: "ebillet",
          ...cinemaPatch,
        } as any,
        { onConflict: "id" },
      );
      if (!error) break;
      const isSlugCollision =
        error.code === "23505" || /cinemas_slug_key|duplicate key/i.test(error.message);
      if (!isSlugCollision || attempt === 2) {
        throw new Error(`cinema insert ${cinemaId}: ${error.message}`);
      }
      const fresh = await loadAll<CinemaRow>(
        db,
        "cinemas",
        "id, name, slug, city, ebillet_organizer_id",
      );
      slug = uniqueCinemaSlug(matchInput, fresh, cinemaId);
    }
  }


  counts.cinemas = 1;

  await db
    .from("ebillet_organizers")
    .update({ cinema_id: cinemaId })
    .eq("id", organizerId);

  // ---- 2. Movies ---------------------------------------------------------
  // eBillet models a film as a "movie base" with one or more concrete
  // "movies" (versions: dubbed, 3D, original …). We collapse versions into
  // a single Lanterna movie, keyed by baseId when available.
  const movieById = new Map(payload.movies.map((m) => [m.id, m]));
  const baseById = new Map(payload.movieBases.map((b) => [b.id, b]));

  type Group = { key: string; baseId: number | null; movieIds: number[]; primary: number };
  const groups = new Map<string, Group>();
  for (const st of payload.showtimes) {
    const movie = movieById.get(st.movieId);
    if (!movie) continue;
    const baseId = movie.baseId && movie.baseId > 0 ? movie.baseId : null;
    const key = baseId ? `base-${baseId}` : `movie-${movie.id}`;
    const g = groups.get(key) ?? { key, baseId, movieIds: [], primary: movie.id };
    if (!g.movieIds.includes(movie.id)) g.movieIds.push(movie.id);
    groups.set(key, g);
  }

  const dbMovies = await loadAll<MovieRow>(
    db,
    "movies",
    "id, title, runtime, synopsis, director, genre, poster, trailer_url, ebillet_movie_base_id, ebillet_movie_ids",
  );
  const movieIdForGroup = new Map<string, string>();

  for (const group of groups.values()) {
    const primary = movieById.get(group.primary)!;
    const base = group.baseId ? baseById.get(group.baseId) : undefined;
    const title = (base?.name ?? primary.name ?? "").trim();
    if (!title) continue;

    const existing =
      dbMovies.find(
        (m) =>
          (group.baseId && m.ebillet_movie_base_id === group.baseId) ||
          group.movieIds.some((id) => (m.ebillet_movie_ids ?? []).includes(id)),
      ) ?? dbMovies.find((m) => normKey(m.title) === normKey(title));

    const poster = base?.posters ?? primary.posters ?? {};
    const posterUrl = poster.hd || poster.large || poster.small || null;
    const runtime = parseRuntimeMinutes(primary.length);
    const year = primary.openingDate
      ? Number.parseInt(primary.openingDate.slice(0, 4), 10)
      : 0;
    const genres = primary.genre
      ? primary.genre.split(/[,/]/).map((g) => g.trim()).filter(Boolean)
      : [];
    const synopsis = (primary.description ?? primary.shortDescription ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (existing) {
      // Supplement only: never clobber good Kultunaut data.
      const mergedIds = Array.from(
        new Set([...(existing.ebillet_movie_ids ?? []), ...group.movieIds]),
      );
      const patch: Record<string, unknown> = { ebillet_movie_ids: mergedIds };
      if (group.baseId && !existing.ebillet_movie_base_id) {
        patch.ebillet_movie_base_id = group.baseId;
      }
      if (!existing.runtime && runtime > 0) patch.runtime = runtime;
      if (isBlank(existing.synopsis) && synopsis) patch.synopsis = synopsis;
      if (isBlank(existing.director) && primary.directors?.length) {
        patch.director = primary.directors.join(", ");
      }
      if ((existing.genre ?? []).length === 0 && genres.length > 0) patch.genre = genres;
      if (isBlank(existing.trailer_url) && primary.trailer) patch.trailer_url = primary.trailer;
      const hasPoster = Object.values(existing.poster ?? {}).some(
        (v) => typeof v === "string" && v.trim() !== "",
      );
      if (!hasPoster && posterUrl) patch.poster = { url: posterUrl };
      const { error } = await db.from("movies").update(patch as any).eq("id", existing.id);
      if (error) throw new Error(`movie update ${existing.id}: ${error.message}`);
      movieIdForGroup.set(group.key, existing.id);
    } else {
      const id = `eb-${group.key}`;
      const row = {
        id,
        slug: slugify(title) || id,
        title,
        original_title: primary.originalName || null,
        runtime,
        genre: genres,
        year: Number.isFinite(year) && year > 1900 ? year : 0,
        director: primary.directors?.join(", ") ?? "",
        rating: primary.ageCensoring ?? "",
        synopsis,
        poster: posterUrl ? { url: posterUrl } : {},
        trailer_url: primary.trailer ?? null,
        source: "ebillet",
        ebillet_movie_base_id: group.baseId,
        ebillet_movie_ids: group.movieIds,
      };
      const { error } = await db.from("movies").upsert(row as any, { onConflict: "id" });
      if (error) throw new Error(`movie insert ${id}: ${error.message}`);
      dbMovies.push({
        id,
        title,
        runtime,
        synopsis,
        director: row.director,
        genre: genres,
        poster: row.poster as Record<string, unknown>,
        trailer_url: row.trailer_url,
        ebillet_movie_base_id: group.baseId,
        ebillet_movie_ids: group.movieIds,
      });
      movieIdForGroup.set(group.key, id);
      counts.movies += 1;
    }
  }
  counts.movies = Math.max(counts.movies, groups.size);

  // ---- 3. Showtimes ------------------------------------------------------
  const typeName = new Map(payload.showtimeTypes.map((t) => [String(t.id), t.name]));

  type Grouped = {
    movie_id: string;
    cinema_id: string;
    date: string;
    hall: string;
    timeUrls: Map<string, string>;
    showtimeIds: number[];
    formats: string[];
    languages: string[];
    events: string[];
    freeSeats: number | null;
    minPrice: number | null;
    maxPrice: number | null;
  };
  const grouped = new Map<string, Grouped>();

  for (const st of payload.showtimes) {
    const movie = movieById.get(st.movieId);
    if (!movie) continue;
    const baseId = movie.baseId && movie.baseId > 0 ? movie.baseId : null;
    const key = baseId ? `base-${baseId}` : `movie-${movie.id}`;
    const movieId = movieIdForGroup.get(key);
    if (!movieId) continue;

    // dateTime already carries the local Danish offset — take it verbatim.
    const date = st.dateTime.slice(0, 10);
    const time = st.dateTime.slice(11, 16);
    const hall = (st.locationName ?? "").trim() || "Sal";
    const gk = `${movieId}|${date}|${hall}`;
    const fresh: Grouped = {
        movie_id: movieId,
        cinema_id: cinemaId,
        date,
        hall,
        timeUrls: new Map<string, string>(),
        showtimeIds: [],
        formats: [],
        languages: [],
        events: [],
        freeSeats: null,
        minPrice: null,
      maxPrice: null,
    };
    const g = grouped.get(gk) ?? fresh;

    g.timeUrls.set(time, ebilletBookingUrl(organizerId, st.movieId, st.id));
    if (!g.showtimeIds.includes(st.id)) g.showtimeIds.push(st.id);

    const format = movie.is3D || movie.dimension === "3" ? "3D" : "2D";
    if (!g.formats.includes(format)) g.formats.push(format);
    if (movie.isAtmos && !g.formats.includes("Atmos")) g.formats.push("Atmos");
    const evt = st.type != null ? typeName.get(String(st.type)) : undefined;
    if (evt && !g.events.includes(evt)) g.events.push(evt);

    const free = typeof st.freeSeats === "number" ? st.freeSeats : null;
    if (free !== null) g.freeSeats = (g.freeSeats ?? 0) + free;
    const min = st.minPrice != null ? Number(st.minPrice) : null;
    const max = st.maxPrice != null ? Number(st.maxPrice) : null;
    if (min !== null && Number.isFinite(min)) g.minPrice = g.minPrice === null ? min : Math.min(g.minPrice, min);
    if (max !== null && Number.isFinite(max)) g.maxPrice = g.maxPrice === null ? max : Math.max(g.maxPrice, max);

    grouped.set(gk, g);
  }

  for (const g of grouped.values()) {
    const times = Array.from(g.timeUrls.keys()).sort();
    const ticketUrls = times.map((t) => g.timeUrls.get(t) ?? "");
    const primaryUrl = ticketUrls.find((u) => u) ?? null;
    const startTime = times[0] ? new Date(`${g.date}T${times[0]}:00`).toISOString() : null;

    const { data: existing } = await db
      .from("showtimes")
      .select("id, source, times, ticket_urls")
      .eq("movie_id", g.movie_id)
      .eq("cinema_id", g.cinema_id)
      .eq("date", g.date)
      .eq("hall", g.hall)
      .maybeSingle();

    const base = {
      times,
      ticket_url: primaryUrl,
      ticket_urls: ticketUrls,
      booking_url: primaryUrl,
      start_time: startTime,
      formats: g.formats,
      events: g.events,
      languages: g.languages,
      ebillet_showtime_ids: g.showtimeIds,
      free_seats: g.freeSeats,
      min_price: g.minPrice,
      max_price: g.maxPrice,
    };

    if (existing) {
      const { error } = await db
        .from("showtimes")
        .update({
          ...base,
          source: existing.source === "kultunaut" ? "kultunaut+ebillet" : "ebillet",
        })
        .eq("id", existing.id);
      if (error) throw new Error(`showtime update: ${error.message}`);
    } else {
      const { error } = await db.from("showtimes").insert({
        movie_id: g.movie_id,
        cinema_id: g.cinema_id,
        date: g.date,
        hall: g.hall,
        source: "ebillet",
        external_id: `eb-${organizerId}-${g.showtimeIds[0]}`,
        ...base,
      });
      if (error) throw new Error(`showtime insert: ${error.message}`);
    }
    counts.showtimes += 1;
  }

  await db
    .from("ebillet_organizers")
    .update({
      last_synced_at: new Date().toISOString(),
      last_sync_status: "success",
      last_sync_error: null,
      last_sync_counts: counts,
      showtime_count: payload.showtimes.length,
      is_active: payload.showtimes.length > 0 && classification.isCinema,
    })
    .eq("id", organizerId);

  log("organizer_synced", { organizerId, ...counts });
  return counts;
}

// --------------------------------------------------------------- run driver

type RunRow = {
  id: string;
  kind: string;
  status: string;
  cursor: number;
  organizers_found: number;
  organizers_active: number;
  organizers_synced: number;
  organizers_failed: number;
  cinemas_upserted: number;
  movies_upserted: number;
  showtimes_upserted: number;
  errors: string[];
  started_at: string;
};

async function finishRun(
  db: any,
  run: RunRow,
  status: "completed" | "failed",
  message: string | null,
) {
  const started = new Date(run.started_at).getTime();
  await db
    .from("ebillet_sync_runs")
    .update({
      status,
      message,
      finished_at: new Date().toISOString(),
      duration_seconds: Math.round((Date.now() - started) / 100) / 10,
    })
    .eq("id", run.id);
}

/**
 * Start or resume an eBillet run.
 *   kind "discover" — probe the organizer id space and register organizers.
 *   kind "sync"     — import every active organizer, one at a time.
 * Failures are recorded per organizer; the run continues.
 */
export async function runEbilletJob(opts: {
  kind: "discover" | "sync";
  trigger?: string;
  budgetMs?: number;
  maxId?: number;
}): Promise<SyncRunSummary> {
  const db = await admin();
  const budgetMs = opts.budgetMs ?? WALL_CLOCK_BUDGET_MS;
  const startedAt = Date.now();

  // Resume an in-flight run of the same kind, otherwise claim a new one.
  const { data: inFlight } = await db
    .from("ebillet_sync_runs")
    .select("*")
    .eq("status", "running")
    .maybeSingle();

  let run = inFlight as RunRow | null;
  if (run && run.kind !== opts.kind) {
    // Another kind is mid-flight; drain it instead of racing it.
    opts = { ...opts, kind: run.kind as "discover" | "sync" };
  }
  if (!run) {
    const { data, error } = await db
      .from("ebillet_sync_runs")
      .insert({
        kind: opts.kind,
        trigger: opts.trigger ?? "manual",
        status: "running",
        cursor: 0,
      })
      .select("*")
      .single();
    if (error) throw new Error(`Kunne ikke starte eBillet-kørsel: ${error.message}`);
    run = data as RunRow;
  }

  const errors: string[] = Array.isArray(run.errors) ? [...run.errors] : [];
  let done = false;
  let message: string | null = null;

  try {
    if (run.kind === "discover") {
      const result = await discoverOrganizers({
        fromId: run.cursor > 0 ? run.cursor : 1,
        maxId: opts.maxId,
        budgetMs,
      });
      errors.push(...result.errors);

      const { count: foundCount } = await db
        .from("ebillet_organizers")
        .select("id", { count: "exact", head: true });
      const { count: activeCount } = await db
        .from("ebillet_organizers")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true);

      run.organizers_found = foundCount ?? 0;
      run.organizers_active = activeCount ?? 0;
      done = result.nextId === null;
      message = done
        ? `Fandt ${run.organizers_found} organizers, heraf ${run.organizers_active} aktive biografer`
        : `Scanner… næste id ${result.nextId}`;

      await db
        .from("ebillet_sync_runs")
        .update({
          cursor: result.nextId ?? 0,
          organizers_found: run.organizers_found,
          organizers_active: run.organizers_active,
          errors: errors.slice(-200),
          message,
        })
        .eq("id", run.id);
    } else {
      const { data: organizers, error: orgErr } = await db
        .from("ebillet_organizers")
        .select("id")
        .eq("is_active", true)
        .order("id", { ascending: true });
      if (orgErr) throw new Error(`organizer-liste: ${orgErr.message}`);
      const ids = (organizers ?? []).map((o: { id: number }) => o.id);
      run.organizers_active = ids.length;

      let index = run.cursor;
      while (index < ids.length) {
        if (Date.now() - startedAt > budgetMs) break;
        const organizerId = ids[index];
        try {
          const c = await syncOrganizer(organizerId);
          run.organizers_synced += 1;
          run.cinemas_upserted += c.cinemas;
          run.movies_upserted += c.movies;
          run.showtimes_upserted += c.showtimes;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          run.organizers_failed += 1;
          errors.push(`organizer ${organizerId}: ${msg}`);
          logError("organizer_failed", { organizerId, message: msg });
          await db
            .from("ebillet_organizers")
            .update({
              last_synced_at: new Date().toISOString(),
              last_sync_status: "failed",
              last_sync_error: msg.slice(0, 500),
            })
            .eq("id", organizerId);
        }
        index += 1;
      }

      done = index >= ids.length;
      message = done
        ? `Synkroniserede ${run.organizers_synced}/${ids.length} biografer`
        : `Synkroniserer… ${index}/${ids.length}`;

      await db
        .from("ebillet_sync_runs")
        .update({
          cursor: done ? 0 : index,
          organizers_active: ids.length,
          organizers_synced: run.organizers_synced,
          organizers_failed: run.organizers_failed,
          cinemas_upserted: run.cinemas_upserted,
          movies_upserted: run.movies_upserted,
          showtimes_upserted: run.showtimes_upserted,
          errors: errors.slice(-200),
          message,
        })
        .eq("id", run.id);
    }

    if (done) await finishRun(db, run, "completed", message);

    return {
      runId: run.id,
      kind: run.kind as "discover" | "sync",
      status: done ? "completed" : "running",
      organizersFound: run.organizers_found,
      organizersActive: run.organizers_active,
      organizersSynced: run.organizers_synced,
      organizersFailed: run.organizers_failed,
      cinemas: run.cinemas_upserted,
      movies: run.movies_upserted,
      showtimes: run.showtimes_upserted,
      errors: errors.slice(-20),
      message,
      done,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    await db
      .from("ebillet_sync_runs")
      .update({ errors: errors.slice(-200) })
      .eq("id", run.id);
    await finishRun(db, run, "failed", msg);
    logError("run_failed", { runId: run.id, message: msg });
    return {
      runId: run.id,
      kind: run.kind as "discover" | "sync",
      status: "failed",
      organizersFound: run.organizers_found,
      organizersActive: run.organizers_active,
      organizersSynced: run.organizers_synced,
      organizersFailed: run.organizers_failed,
      cinemas: run.cinemas_upserted,
      movies: run.movies_upserted,
      showtimes: run.showtimes_upserted,
      errors: errors.slice(-20),
      message: msg,
      done: true,
    };
  }
}

/** Close a run that has been stuck in `running` for too long. */
export async function reapStaleEbilletRuns(maxAgeMinutes = 60): Promise<number> {
  const db = await admin();
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000).toISOString();
  const { data } = await db
    .from("ebillet_sync_runs")
    .update({
      status: "failed",
      message: "Kørslen blev afbrudt og lukket automatisk",
      finished_at: new Date().toISOString(),
    })
    .eq("status", "running")
    .lt("started_at", cutoff)
    .select("id");
  return (data ?? []).length;
}
