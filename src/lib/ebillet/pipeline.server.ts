/**
 * eBillet import pipeline — the active path.
 *
 *   fetch -> validate -> normalize -> resolve -> stage -> promote -> mark
 *
 * Compared to the legacy `sync.server.ts` orchestration this module:
 *  - records every payload as an `import_snapshots` row before touching data,
 *  - resolves identity through `source_entity_refs` instead of re-matching
 *    names on every run,
 *  - writes one row per physical screening into `screenings`,
 *  - performs all destructive work inside the scoped `promote_screenings` RPC,
 *  - keeps the legacy `showtimes` read model in sync for the current frontend.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchOrganizerPayload, type EbilletMoviesResponse } from "./api.server";
import { buildMovieGroups, normalizeEbilletScreenings, type EbilletMovieGroup } from "./normalize";
import { matchMovie, validateSnapshot } from "./reconcile";
import { matchCinema, slugifyName, uniqueCinemaSlug, type MatchCinema } from "./cinema-match";
import { classifyOrganizer } from "./venue-filter";
import { loadRefs, recordUnresolved, upsertRefs } from "@/lib/pipeline/identity.server";
import {
  applyValidation,
  createSnapshot,
  markSnapshotFailed,
  stageScreenings,
} from "@/lib/pipeline/snapshots.server";
import { promoteCinema } from "@/lib/pipeline/promote.server";
import { toPromotionRow } from "@/lib/pipeline/types";

export type OrganizerPipelineResult = {
  organizerId: number;
  cinemaId: string | null;
  skipped: boolean;
  reason?: string;
  snapshotId?: string;
  movies: number;
  screenings: number;
  upserted: number;
  deleted: number;
};

const CINEMA_COLUMNS = "id, name, slug, city, ebillet_organizer_id";
const MOVIE_COLUMNS =
  "id, title, year, runtime, synopsis, director, genre, poster, trailer_url, ebillet_movie_base_id, ebillet_movie_ids";

type CinemaRow = MatchCinema;
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

const isBlank = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "");
const dedupeById = <T extends { id: string | number }>(rows: T[]): T[] => {
  const map = new Map<string | number, T>();
  for (const r of rows) if (!map.has(r.id)) map.set(r.id, r);
  return [...map.values()];
};

// ------------------------------------------------------------------ resolve

/** Bind an organizer to its canonical cinema: ref first, then a match, else create. */
async function resolveCinema(
  organizerId: number,
  payload: EbilletMoviesResponse,
): Promise<{ cinemaId: string; created: boolean }> {
  const organizer = payload.organizers.find((o) => o.id === organizerId)!;
  const city = organizer.address?.city ?? "";

  const refs = await loadRefs("ebillet", "cinema", [String(organizerId)]);
  const known = refs.get(String(organizerId));
  const patch = {
    ebillet_organizer_id: organizerId,
    screens: Math.max(organizer.locations?.length ?? 1, 1),
  };

  if (known) {
    const { error } = await supabaseAdmin
      .from("cinemas")
      .update(patch as never)
      .eq("id", known.canonicalId);
    if (error) throw new Error(`cinema update ${known.canonicalId}: ${error.message}`);
    return { cinemaId: known.canonicalId, created: false };
  }

  const matchInput = { id: organizerId, name: organizer.name, city };
  const bareCity = city.replace(/^\s*(?:DK[-\s]?)?\d{3,4}\b/iu, "").trim();
  const base = slugifyName(organizer.name);
  const slugs = [...new Set([base, slugifyName(`${organizer.name} ${bareCity}`), `${base}-${organizerId}`])];
  const firstToken = organizer.name.trim().split(/\s+/)[0] ?? organizer.name;
  const [byOrg, bySlug, byName] = await Promise.all([
    supabaseAdmin.from("cinemas").select(CINEMA_COLUMNS).eq("ebillet_organizer_id", organizerId),
    supabaseAdmin.from("cinemas").select(CINEMA_COLUMNS).in("slug", slugs),
    supabaseAdmin.from("cinemas").select(CINEMA_COLUMNS).ilike("name", `${firstToken}%`).limit(50),
  ]);
  for (const r of [byOrg, bySlug, byName]) if (r.error) throw new Error(`cinemas: ${r.error.message}`);
  const candidates = dedupeById<CinemaRow>([
    ...((byOrg.data ?? []) as CinemaRow[]),
    ...((bySlug.data ?? []) as CinemaRow[]),
    ...((byName.data ?? []) as CinemaRow[]),
  ]);

  const existing = matchCinema(matchInput, candidates);
  if (existing) {
    const { error } = await supabaseAdmin
      .from("cinemas")
      .update(patch as never)
      .eq("id", existing.id);
    if (error) throw new Error(`cinema update ${existing.id}: ${error.message}`);
    await upsertRefs([
      {
        source: "ebillet",
        entityType: "cinema",
        externalId: String(organizerId),
        canonicalId: existing.id,
        matchMethod: "external_id",
        confidence: 1,
        locked: true,
        notes: "organizer bound to existing venue",
      },
    ]);
    return { cinemaId: existing.id, created: false };
  }

  // Genuinely new venue: identity is the organizer id, so creating is safe.
  const cinemaId = `eb-${organizerId}`;
  let slug = uniqueCinemaSlug(matchInput, candidates, cinemaId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await supabaseAdmin.from("cinemas").upsert(
      {
        id: cinemaId,
        slug,
        name: organizer.name,
        city: city || "Danmark",
        address: organizer.address?.roadAndNumber ?? "",
        description: "",
        source: "ebillet",
        ...patch,
      } as never,
      { onConflict: "id" },
    );
    if (!error) break;
    const collision = error.code === "23505" || /slug|duplicate key/i.test(error.message);
    if (!collision || attempt === 2) throw new Error(`cinema insert ${cinemaId}: ${error.message}`);
    const { data: fresh } = await supabaseAdmin.from("cinemas").select(CINEMA_COLUMNS);
    slug = uniqueCinemaSlug(matchInput, (fresh ?? []) as CinemaRow[], cinemaId);
  }
  await upsertRefs([
    {
      source: "ebillet",
      entityType: "cinema",
      externalId: String(organizerId),
      canonicalId: cinemaId,
      matchMethod: "created",
      confidence: 1,
      locked: true,
    },
  ]);
  return { cinemaId, created: true };
}

/** Map every movie group to a canonical movie id, creating rows when new. */
async function resolveMovies(groups: EbilletMovieGroup[]): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  if (groups.length === 0) return resolved;

  const refs = await loadRefs("ebillet", "movie", groups.map((g) => g.ref));
  const pending = groups.filter((g) => {
    const known = refs.get(g.ref);
    if (known) resolved.set(g.ref, known.canonicalId);
    return !known;
  });
  if (pending.length === 0) return resolved;

  const baseIds = pending.map((g) => g.baseId).filter((v): v is number => v != null);
  const movieIds = pending.flatMap((g) => g.movieIds);
  const titles = pending.map((g) => g.title);
  const queries = [] as Array<PromiseLike<{ data: MovieRow[] | null; error: { message: string } | null }>>;
  if (baseIds.length)
    queries.push(supabaseAdmin.from("movies").select(MOVIE_COLUMNS).in("ebillet_movie_base_id", baseIds) as never);
  if (movieIds.length)
    queries.push(supabaseAdmin.from("movies").select(MOVIE_COLUMNS).overlaps("ebillet_movie_ids", movieIds) as never);
  if (titles.length)
    queries.push(supabaseAdmin.from("movies").select(MOVIE_COLUMNS).in("title", titles) as never);
  const results = await Promise.all(queries);
  const candidates: MovieRow[] = [];
  for (const r of results) {
    if (r.error) throw new Error(`movies: ${r.error.message}`);
    candidates.push(...((r.data ?? []) as MovieRow[]));
  }
  const pool = dedupeById(candidates);
  const newRefs: Parameters<typeof upsertRefs>[0] = [];

  for (const group of pending) {
    const match = matchMovie(
      {
        baseId: group.baseId,
        movieIds: group.movieIds,
        title: group.title,
        year: group.year > 0 ? group.year : null,
      },
      pool.map((m) => ({
        id: m.id,
        title: m.title,
        year: m.year && m.year > 0 ? m.year : null,
        ebillet_movie_base_id: m.ebillet_movie_base_id,
        ebillet_movie_ids: m.ebillet_movie_ids,
      })),
    );

    if (match) {
      const row = pool.find((m) => m.id === match.id)!;
      const mergedIds = [...new Set([...(row.ebillet_movie_ids ?? []), ...group.movieIds])];
      const patch: Record<string, unknown> = { ebillet_movie_ids: mergedIds };
      if (group.baseId && !row.ebillet_movie_base_id) patch.ebillet_movie_base_id = group.baseId;
      if (!row.runtime && group.runtime > 0) patch.runtime = group.runtime;
      if (isBlank(row.synopsis) && group.synopsis) patch.synopsis = group.synopsis;
      if (isBlank(row.director) && group.director) patch.director = group.director;
      if ((row.genre ?? []).length === 0 && group.genres.length) patch.genre = group.genres;
      if (isBlank(row.trailer_url) && group.trailerUrl) patch.trailer_url = group.trailerUrl;
      const hasPoster = Object.values(row.poster ?? {}).some(
        (v) => typeof v === "string" && v.trim() !== "",
      );
      if (!hasPoster && group.posterUrl) patch.poster = { url: group.posterUrl };
      const { error } = await supabaseAdmin.from("movies").update(patch as never).eq("id", row.id);
      if (error) throw new Error(`movie update ${row.id}: ${error.message}`);
      row.ebillet_movie_ids = mergedIds;
      resolved.set(group.ref, row.id);
      newRefs.push({
        source: "ebillet",
        entityType: "movie",
        externalId: group.ref,
        canonicalId: row.id,
        matchMethod: group.baseId || group.movieIds.length ? "external_id" : "deterministic",
        confidence: 1,
        locked: true,
      });
      continue;
    }

    const id = `eb-${group.ref}`;
    const { error } = await supabaseAdmin.from("movies").upsert(
      {
        id,
        slug: slugifyName(group.title) || id,
        title: group.title,
        original_title: group.originalTitle,
        runtime: group.runtime,
        genre: group.genres,
        year: group.year,
        director: group.director,
        rating: group.rating,
        synopsis: group.synopsis,
        poster: group.posterUrl ? { url: group.posterUrl } : {},
        trailer_url: group.trailerUrl,
        source: "ebillet",
        ebillet_movie_base_id: group.baseId,
        ebillet_movie_ids: group.movieIds,
      } as never,
      { onConflict: "id" },
    );
    if (error) throw new Error(`movie insert ${id}: ${error.message}`);
    pool.push({
      id,
      title: group.title,
      year: group.year,
      runtime: group.runtime,
      synopsis: group.synopsis,
      director: group.director,
      genre: group.genres,
      poster: {},
      trailer_url: group.trailerUrl,
      ebillet_movie_base_id: group.baseId,
      ebillet_movie_ids: group.movieIds,
    });
    resolved.set(group.ref, id);
    newRefs.push({
      source: "ebillet",
      entityType: "movie",
      externalId: group.ref,
      canonicalId: id,
      matchMethod: "created",
      confidence: 1,
      locked: true,
    });
  }

  const { conflicts } = await upsertRefs(newRefs);
  if (conflicts.length) {
    await recordUnresolved(
      conflicts.map((c) => ({
        source: "ebillet" as const,
        entityType: "movie" as const,
        externalId: c.split(":")[0]?.split("/").pop() ?? "unknown",
        label: c,
        reason: "locked ref conflict",
      })),
    );
  }
  return resolved;
}

// ----------------------------------------------------------------- pipeline

/** Run the full pipeline for one organizer. This is one durable unit of work. */
export async function runOrganizerPipeline(organizerId: number): Promise<OrganizerPipelineResult> {
  const nowIso = () => new Date().toISOString();
  const payload = await fetchOrganizerPayload([organizerId]);
  const organizer = payload.organizers.find((o) => o.id === organizerId);
  if (!organizer) throw new Error(`Organizer ${organizerId} findes ikke hos eBillet`);

  const classification = classifyOrganizer({ id: organizerId, name: organizer.name });
  if (!classification.isCinema) {
    await supabaseAdmin
      .from("ebillet_organizers")
      .update({
        is_active: false,
        last_synced_at: nowIso(),
        last_sync_status: "skipped",
        last_sync_error: classification.reason,
      })
      .eq("id", organizerId);
    return {
      organizerId,
      cinemaId: null,
      skipped: true,
      reason: classification.reason,
      movies: 0,
      screenings: 0,
      upserted: 0,
      deleted: 0,
    };
  }

  const { cinemaId } = await resolveCinema(organizerId, payload);
  await supabaseAdmin
    .from("ebillet_organizers")
    .update({ cinema_id: cinemaId })
    .eq("id", organizerId);

  const snapshot = await createSnapshot({
    source: "ebillet",
    scopeType: "organizer",
    scopeExternalId: String(organizerId),
    payload,
  });

  const { count: existingRows } = await supabaseAdmin
    .from("screenings")
    .select("id", { count: "exact", head: true })
    .eq("cinema_id", cinemaId)
    .eq("source", "ebillet");

  const verdictRaw = validateSnapshot(organizerId, payload, {
    existingRowCount: existingRows ?? 0,
  });
  const screeningCount = payload.showtimes.filter((s) => s.organizerId === organizerId).length;
  const promotable = await applyValidation(snapshot.id, {
    verdict: verdictRaw.ok ? (screeningCount > 0 ? "complete" : "valid-empty") : "incomplete",
    reasons: verdictRaw.ok ? [] : [verdictRaw.reason],
    stats: {
      showtimes: screeningCount,
      movies: payload.movies.length,
      existingRows: existingRows ?? 0,
    },
  });

  if (!promotable) {
    await supabaseAdmin
      .from("ebillet_organizers")
      .update({
        last_synced_at: nowIso(),
        last_sync_status: "rejected",
        last_sync_error: (verdictRaw.ok ? "afvist" : verdictRaw.reason).slice(0, 500),
      })
      .eq("id", organizerId);
    throw new Error(`Payload afvist: ${verdictRaw.ok ? "ukendt" : verdictRaw.reason}`);
  }

  const groups = buildMovieGroups(payload);
  const movieIdByRef = await resolveMovies(groups);

  const normalized = normalizeEbilletScreenings(organizerId, payload).filter((s) =>
    movieIdByRef.has(s.sourceMovieRef),
  );
  await stageScreenings(snapshot.id, "ebillet", normalized);

  const rows = normalized.map((s) => toPromotionRow(s, movieIdByRef.get(s.sourceMovieRef)!));
  const outcome = await promoteCinema({
    snapshotId: snapshot.id,
    source: "ebillet",
    cinemaId,
    rows,
  }).catch(async (err: unknown) => {
    await markSnapshotFailed(snapshot.id, err instanceof Error ? err.message : String(err));
    throw err;
  });

  const counts = { cinemas: 1, movies: groups.length, showtimes: rows.length };
  await supabaseAdmin
    .from("ebillet_organizers")
    .update({
      last_synced_at: nowIso(),
      last_sync_status: "success",
      last_sync_error: null,
      last_sync_counts: counts,
      showtime_count: screeningCount,
      is_active: screeningCount > 0,
    })
    .eq("id", organizerId);

  return {
    organizerId,
    cinemaId,
    skipped: false,
    snapshotId: snapshot.id,
    movies: groups.length,
    screenings: rows.length,
    upserted: outcome.upserted,
    deleted: outcome.deleted,
  };
}
