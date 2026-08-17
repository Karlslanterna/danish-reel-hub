/**
 * eBillet import pipeline — the active path.
 *
 *   fetch -> snapshot -> validate -> resolve -> normalize -> stage -> promote
 *
 * Canonical screening writes are atomic and source-scoped. Cinema/movie
 * identity is persisted separately, so subsequent imports reuse source-native
 * ids instead of repeating fuzzy matching.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { fetchOrganizerPayload, type EbilletMoviesResponse } from "./api.server";
import {
  buildMovieGroups,
  normalizeEbilletScreenings,
  type EbilletMovieGroup,
} from "./normalize";
import { matchMovie, validateSnapshot } from "./reconcile";
import {
  matchCinema,
  plausibleCinemaConflicts,
  slugifyName,
  uniqueCinemaSlug,
  type MatchCinema,
} from "./cinema-match";
import { classifyOrganizer } from "./venue-filter";
import {
  buildEbilletMovieSupplementPatch,
  sourceRefsForMovieGroup,
} from "./movie-metadata";
import {
  clearUnresolved,
  loadRefs,
  recordUnresolved,
  upsertRefs,
  type RefInput,
} from "@/lib/pipeline/identity.server";
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
  reason?: string | null;
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

const dedupeById = <T extends { id: string | number }>(rows: T[]): T[] => {
  const map = new Map<string | number, T>();
  for (const row of rows) if (!map.has(row.id)) map.set(row.id, row);
  return [...map.values()];
};

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// ------------------------------------------------------------------ cinema identity

/**
 * Read-only lookup used before validation. It deliberately performs no
 * name-based matching or writes: only persisted identity links count as
 * existing production state when deciding whether an empty snapshot is safe.
 */
async function findKnownCinemaId(organizerId: number): Promise<string | null> {
  const refs = await loadRefs("ebillet", "cinema", [String(organizerId)]);
  const mapped = refs.get(String(organizerId));
  if (mapped) return mapped.canonicalId;

  const [{ data: organizer, error: organizerError }, { data: cinema, error: cinemaError }] =
    await Promise.all([
      supabaseAdmin
        .from("ebillet_organizers")
        .select("cinema_id")
        .eq("id", organizerId)
        .maybeSingle(),
      supabaseAdmin
        .from("cinemas")
        .select("id")
        .eq("ebillet_organizer_id", organizerId)
        .maybeSingle(),
    ]);
  if (organizerError) throw new Error(`organizer lookup ${organizerId}: ${organizerError.message}`);
  if (cinemaError) throw new Error(`cinema lookup ${organizerId}: ${cinemaError.message}`);
  return organizer?.cinema_id ?? cinema?.id ?? null;
}

/** Bind an organizer to one canonical cinema, or park ambiguous identity. */
async function resolveCinema(
  organizerId: number,
  payload: EbilletMoviesResponse,
): Promise<{ cinemaId: string; created: boolean }> {
  const organizer = payload.organizers.find((o) => o.id === organizerId)!;
  const city = organizer.address?.city ?? "";
  const externalId = String(organizerId);

  const refs = await loadRefs("ebillet", "cinema", [externalId]);
  const known = refs.get(externalId);
  const patch = {
    ebillet_organizer_id: organizerId,
    source: "ebillet",
    screens: Math.max(organizer.locations?.length ?? 1, 1),
  };

  if (known) {
    const { data, error } = await supabaseAdmin
      .from("cinemas")
      .update(patch as never)
      .eq("id", known.canonicalId)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(`cinema update ${known.canonicalId}: ${error.message}`);
    if (!data) {
      await recordUnresolved([
        {
          source: "ebillet",
          entityType: "cinema",
          externalId,
          label: organizer.name,
          reason: `locked mapping points to missing cinema ${known.canonicalId}`,
        },
      ]);
      throw new Error(`eBillet organizer ${organizerId} peger på en manglende canonical biograf`);
    }
    await clearUnresolved("ebillet", "cinema", [externalId]);
    return { cinemaId: known.canonicalId, created: false };
  }

  const matchInput = { id: organizerId, name: organizer.name, city };
  const bareCity = city.replace(/^\s*(?:DK[-\s]?)?\d{3,4}\b/iu, "").trim();
  const base = slugifyName(organizer.name);
  const slugs = [
    ...new Set([base, slugifyName(`${organizer.name} ${bareCity}`), `${base}-${organizerId}`]),
  ];
  const firstToken = organizer.name.trim().split(/\s+/)[0] ?? organizer.name;
  const [byOrg, bySlug, byName] = await Promise.all([
    supabaseAdmin.from("cinemas").select(CINEMA_COLUMNS).eq("ebillet_organizer_id", organizerId),
    supabaseAdmin.from("cinemas").select(CINEMA_COLUMNS).in("slug", slugs),
    supabaseAdmin
      .from("cinemas")
      .select(CINEMA_COLUMNS)
      .ilike("name", `${firstToken}%`)
      .limit(50),
  ]);
  for (const result of [byOrg, bySlug, byName]) {
    if (result.error) throw new Error(`cinemas: ${result.error.message}`);
  }
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
    const { conflicts } = await upsertRefs([
      {
        source: "ebillet",
        entityType: "cinema",
        externalId,
        canonicalId: existing.id,
        matchMethod: "external_id",
        confidence: 1,
        locked: true,
        notes: "organizer bound to existing venue",
      },
    ]);
    if (conflicts.length) throw new Error(conflicts[0]);
    await clearUnresolved("ebillet", "cinema", [externalId]);
    return { cinemaId: existing.id, created: false };
  }

  // A near-match is more likely a spelling/metadata variation than a genuinely
  // new venue. Park it for review instead of creating a duplicate canonical row.
  const plausible = plausibleCinemaConflicts(matchInput, candidates);
  if (plausible.length > 0) {
    await recordUnresolved([
      {
        source: "ebillet",
        entityType: "cinema",
        externalId,
        label: organizer.name,
        reason: "possible existing cinema could not be matched deterministically",
        payload: {
          city,
          candidateIds: plausible.map((c) => c.id),
          candidateNames: plausible.map((c) => c.name),
        },
      },
    ]);
    throw new Error(`eBillet organizer ${organizerId} kræver manuel biografmapping`);
  }

  // No plausible existing venue was found. The organizer id itself is stable
  // external identity, so creating a new canonical cinema is safe.
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
        ...patch,
      } as never,
      { onConflict: "id" },
    );
    if (!error) break;
    const collision = error.code === "23505" || /slug|duplicate key/i.test(error.message);
    if (!collision || attempt === 2) {
      throw new Error(`cinema insert ${cinemaId}: ${error.message}`);
    }
    const { data: fresh } = await supabaseAdmin.from("cinemas").select(CINEMA_COLUMNS);
    slug = uniqueCinemaSlug(matchInput, (fresh ?? []) as CinemaRow[], cinemaId);
  }

  const { conflicts } = await upsertRefs([
    {
      source: "ebillet",
      entityType: "cinema",
      externalId,
      canonicalId: cinemaId,
      matchMethod: "created",
      confidence: 1,
      locked: true,
    },
  ]);
  if (conflicts.length) throw new Error(conflicts[0]);
  await clearUnresolved("ebillet", "cinema", [externalId]);
  return { cinemaId, created: true };
}

// ------------------------------------------------------------------ movie identity

async function uniqueMovieSlug(group: EbilletMovieGroup): Promise<string> {
  const base = slugifyName(group.title) || `ebillet-${slugifyName(group.ref)}`;
  const candidates = [
    base,
    group.year > 0 ? `${base}-${group.year}` : null,
    `${base}-${slugifyName(group.ref)}`,
  ].filter((value): value is string => Boolean(value));

  const { data, error } = await supabaseAdmin.from("movies").select("slug").in("slug", candidates);
  if (error) throw new Error(`movie slug lookup: ${error.message}`);
  const taken = new Set((data ?? []).map((row) => row.slug));
  const free = candidates.find((candidate) => !taken.has(candidate));
  if (free) return free;

  const stem = `${base}-${slugifyName(group.ref)}`;
  for (let n = 2; n < 100; n++) {
    const candidate = `${stem}-${n}`;
    const { data: hit, error: hitError } = await supabaseAdmin
      .from("movies")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (hitError) throw new Error(`movie slug lookup: ${hitError.message}`);
    if (!hit) return candidate;
  }
  throw new Error(`Kunne ikke finde unik filmslug til ${group.title}`);
}

/** Load candidate movies for source-id and conservative title+year matching. */
async function movieCandidates(groups: EbilletMovieGroup[]): Promise<MovieRow[]> {
  if (groups.length === 0) return [];
  const baseIds = groups.map((g) => g.baseId).filter((v): v is number => v != null);
  const movieIds = groups.flatMap((g) => g.movieIds);
  const titles = groups.map((g) => g.title).filter(Boolean);
  const candidateYears = [
    ...new Set(
      groups
        .filter((g) => g.year > 1900)
        .flatMap((g) => [g.year - 1, g.year, g.year + 1]),
    ),
  ];

  const queries = [] as Array<
    PromiseLike<{ data: MovieRow[] | null; error: { message: string } | null }>
  >;
  if (baseIds.length) {
    queries.push(
      supabaseAdmin.from("movies").select(MOVIE_COLUMNS).in("ebillet_movie_base_id", baseIds) as never,
    );
  }
  if (movieIds.length) {
    queries.push(
      supabaseAdmin.from("movies").select(MOVIE_COLUMNS).overlaps("ebillet_movie_ids", movieIds) as never,
    );
  }
  // Exact title catches existing rows with missing years; matchMovie still
  // refuses title-only merging, so this cannot create an unsafe match.
  if (titles.length) {
    queries.push(supabaseAdmin.from("movies").select(MOVIE_COLUMNS).in("title", titles) as never);
  }
  // Year candidates allow normalized punctuation/title matching while keeping
  // the candidate set bounded and preventing title-only remake merges.
  if (candidateYears.length) {
    queries.push(
      supabaseAdmin.from("movies").select(MOVIE_COLUMNS).in("year", candidateYears) as never,
    );
  }

  const results = await Promise.all(queries);
  const rows: MovieRow[] = [];
  for (const result of results) {
    if (result.error) throw new Error(`movies: ${result.error.message}`);
    rows.push(...((result.data ?? []) as MovieRow[]));
  }
  return dedupeById(rows);
}

/** Supplement every resolved canonical movie and verify no persisted ref is orphaned. */
async function supplementResolvedMovies(
  groups: EbilletMovieGroup[],
  resolved: Map<string, string>,
): Promise<void> {
  const ids = [...new Set(resolved.values())];
  const rows: MovieRow[] = [];
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await supabaseAdmin
      .from("movies")
      .select(MOVIE_COLUMNS)
      .in("id", ids.slice(i, i + 300));
    if (error) throw new Error(`resolved movie lookup: ${error.message}`);
    rows.push(...((data ?? []) as MovieRow[]));
  }
  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const group of groups) {
    const canonicalId = resolved.get(group.ref);
    if (!canonicalId) continue;
    const row = byId.get(canonicalId);
    if (!row) {
      await recordUnresolved([
        {
          source: "ebillet",
          entityType: "movie",
          externalId: group.ref,
          label: group.title,
          reason: `source mapping points to missing canonical movie ${canonicalId}`,
        },
      ]);
      throw new Error(`eBillet filmref ${group.ref} peger på en manglende canonical film`);
    }

    const patch = buildEbilletMovieSupplementPatch(row, group);
    if (Object.keys(patch).length > 0) {
      const { error } = await supabaseAdmin
        .from("movies")
        .update(patch as never)
        .eq("id", canonicalId);
      if (error) throw new Error(`movie update ${canonicalId}: ${error.message}`);
      if (Array.isArray(patch.ebillet_movie_ids)) {
        row.ebillet_movie_ids = patch.ebillet_movie_ids as number[];
      }
      if (typeof patch.ebillet_movie_base_id === "number") {
        row.ebillet_movie_base_id = patch.ebillet_movie_base_id;
      }
    }
  }
}

/** Map every eBillet movie group to one canonical movie id. */
async function resolveMovies(groups: EbilletMovieGroup[]): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  if (groups.length === 0) return resolved;

  const refs = await loadRefs(
    "ebillet",
    "movie",
    groups.map((g) => g.ref),
  );
  const pending = groups.filter((group) => {
    const known = refs.get(group.ref);
    if (known) resolved.set(group.ref, known.canonicalId);
    return !known;
  });

  const pool = await movieCandidates(pending);
  const primaryRefs: RefInput[] = [];

  for (const group of pending) {
    const match = matchMovie(
      {
        baseId: group.baseId,
        movieIds: group.movieIds,
        title: group.title,
        year: group.year > 0 ? group.year : null,
      },
      pool.map((movie) => ({
        id: movie.id,
        title: movie.title,
        year: movie.year && movie.year > 0 ? movie.year : null,
        ebillet_movie_base_id: movie.ebillet_movie_base_id,
        ebillet_movie_ids: movie.ebillet_movie_ids,
      })),
    );

    if (match) {
      resolved.set(group.ref, match.id);
      primaryRefs.push({
        source: "ebillet",
        entityType: "movie",
        externalId: group.ref,
        canonicalId: match.id,
        matchMethod: group.baseId || group.movieIds.length ? "external_id" : "deterministic",
        confidence: 1,
        locked: true,
      });
      continue;
    }

    const id = `eb-${group.ref}`;
    const slug = await uniqueMovieSlug(group);
    const { error } = await supabaseAdmin.from("movies").upsert(
      {
        id,
        slug,
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
    resolved.set(group.ref, id);
    pool.push({
      id,
      title: group.title,
      year: group.year,
      runtime: group.runtime,
      synopsis: group.synopsis,
      director: group.director,
      genre: group.genres,
      poster: group.posterUrl ? { url: group.posterUrl } : {},
      trailer_url: group.trailerUrl,
      ebillet_movie_base_id: group.baseId,
      ebillet_movie_ids: group.movieIds,
    });
    primaryRefs.push({
      source: "ebillet",
      entityType: "movie",
      externalId: group.ref,
      canonicalId: id,
      matchMethod: "created",
      confidence: 1,
      locked: true,
    });
  }

  // Persist the primary base/version ref first. Locked conflicts are never
  // silently re-pointed and are surfaced in the unresolved queue.
  const primaryWrite = await upsertRefs(primaryRefs);
  if (primaryWrite.conflicts.length > 0) {
    await recordUnresolved(
      primaryWrite.conflicts.map((conflict) => ({
        source: "ebillet" as const,
        entityType: "movie" as const,
        externalId: conflict.split(":")[0]?.split("/").pop() ?? "unknown",
        label: conflict,
        reason: "locked ref conflict",
      })),
    );
    throw new Error(`eBillet movie identity conflict: ${primaryWrite.conflicts[0]}`);
  }

  // Persist concrete eBillet version ids as aliases to the same canonical
  // movie. This makes identity resilient if a future payload changes base data.
  const aliasRefs: RefInput[] = [];
  for (const group of groups) {
    const canonicalId = resolved.get(group.ref);
    if (!canonicalId) continue;
    for (const externalId of sourceRefsForMovieGroup(group)) {
      aliasRefs.push({
        source: "ebillet",
        entityType: "movie",
        externalId,
        canonicalId,
        matchMethod: externalId === group.ref ? "external_id" : "external_id",
        confidence: 1,
        locked: true,
      });
    }
  }
  const aliasWrite = await upsertRefs(aliasRefs);
  if (aliasWrite.conflicts.length > 0) {
    await recordUnresolved(
      aliasWrite.conflicts.map((conflict) => ({
        source: "ebillet" as const,
        entityType: "movie" as const,
        externalId: conflict.split(":")[0]?.split("/").pop() ?? "unknown",
        label: conflict,
        reason: "locked alias ref conflict",
      })),
    );
    throw new Error(`eBillet movie alias conflict: ${aliasWrite.conflicts[0]}`);
  }

  // Existing refs must still receive newly available metadata/version ids.
  await supplementResolvedMovies(groups, resolved);
  await clearUnresolved(
    "ebillet",
    "movie",
    groups.map((group) => group.ref),
  );
  return resolved;
}

// ----------------------------------------------------------------- pipeline

/** Run the full pipeline for one organizer. This is one durable unit of work. */
export async function runOrganizerPipeline(organizerId: number): Promise<OrganizerPipelineResult> {
  const nowIso = () => new Date().toISOString();
  const payload = await fetchOrganizerPayload([organizerId]);
  const organizer = payload.organizers.find((o) => o.id === organizerId);
  if (!organizer) throw new Error(`Organizer ${organizerId} findes ikke hos eBillet`);

  // Persist the payload before any canonical movie/cinema/screening mutation.
  const snapshot = await createSnapshot({
    source: "ebillet",
    scopeType: "organizer",
    scopeExternalId: String(organizerId),
    payload,
  });

  const screeningCount = payload.showtimes.filter((s) => s.organizerId === organizerId).length;
  const classification = classifyOrganizer({ id: organizerId, name: organizer.name });
  if (!classification.isCinema) {
    await applyValidation(snapshot.id, {
      verdict: "incomplete",
      reasons: [classification.reason],
      stats: { showtimes: screeningCount },
    });
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
      snapshotId: snapshot.id,
      movies: 0,
      screenings: 0,
      upserted: 0,
      deleted: 0,
    };
  }

  // Validation needs existing-row context but must not create or mutate the
  // cinema just to obtain it. If even that lookup fails, the snapshot is failed
  // rather than left forever in the ambiguous `received` state.
  let knownCinemaId: string | null;
  try {
    knownCinemaId = await findKnownCinemaId(organizerId);
  } catch (err) {
    await markSnapshotFailed(snapshot.id, errorMessage(err));
    throw err;
  }

  let existingRows = 0;
  if (knownCinemaId) {
    const { count, error } = await supabaseAdmin
      .from("screenings")
      .select("id", { count: "exact", head: true })
      .eq("cinema_id", knownCinemaId)
      .eq("source", "ebillet");
    if (error) {
      await markSnapshotFailed(snapshot.id, error.message);
      throw new Error(`existing screenings ${knownCinemaId}: ${error.message}`);
    }
    existingRows = count ?? 0;
  }

  const verdictRaw = validateSnapshot(organizerId, payload, { existingRowCount: existingRows });
  const promotable = await applyValidation(snapshot.id, {
    verdict: verdictRaw.ok ? (screeningCount > 0 ? "complete" : "valid-empty") : "incomplete",
    reasons: verdictRaw.ok ? [] : [verdictRaw.reason],
    stats: {
      showtimes: screeningCount,
      movies: payload.movies.length,
      existingRows,
      knownCinemaId,
    },
  });

  if (!promotable) {
    const reason = verdictRaw.ok ? "afvist" : verdictRaw.reason;
    await supabaseAdmin
      .from("ebillet_organizers")
      .update({
        last_synced_at: nowIso(),
        last_sync_status: "rejected",
        last_sync_error: reason.slice(0, 500),
      })
      .eq("id", organizerId);
    throw new Error(`Payload afvist: ${reason}`);
  }

  // A new organizer with a valid but empty snapshot has nothing canonical to
  // create yet. Keep the registry entry and snapshot, and poll it again later.
  if (!knownCinemaId && screeningCount === 0) {
    await supabaseAdmin
      .from("import_snapshots")
      .update({ status: "promoted" })
      .eq("id", snapshot.id);
    await supabaseAdmin
      .from("ebillet_organizers")
      .update({
        is_active: false,
        showtime_count: 0,
        last_synced_at: nowIso(),
        last_sync_status: "success",
        last_sync_error: null,
        last_sync_counts: { cinemas: 0, movies: 0, showtimes: 0 },
      })
      .eq("id", organizerId);
    return {
      organizerId,
      cinemaId: null,
      skipped: false,
      snapshotId: snapshot.id,
      movies: 0,
      screenings: 0,
      upserted: 0,
      deleted: 0,
    };
  }

  // All post-validation failures mark the snapshot and organizer as failed.
  // Existing screenings remain untouched unless the final atomic promotion RPC
  // succeeds for this exact source+cinema scope.
  try {
    const { cinemaId } = await resolveCinema(organizerId, payload);
    const { error: organizerLinkError } = await supabaseAdmin
      .from("ebillet_organizers")
      .update({ cinema_id: cinemaId })
      .eq("id", organizerId);
    if (organizerLinkError) throw new Error(`organizer link: ${organizerLinkError.message}`);

    const groups = buildMovieGroups(payload);
    const movieIdByRef = await resolveMovies(groups);
    const normalized = normalizeEbilletScreenings(organizerId, payload).filter((screening) =>
      movieIdByRef.has(screening.sourceMovieRef),
    );

    // Every valid source screening must resolve to a movie. Silent dropping
    // would turn an identity problem into destructive stale-screening cleanup.
    const expectedRefs = new Set(
      normalizeEbilletScreenings(organizerId, payload).map((screening) => screening.sourceRef),
    );
    if (normalized.length !== expectedRefs.size) {
      throw new Error(
        `eBillet normalization resolved ${normalized.length}/${expectedRefs.size} valid screenings to canonical movies`,
      );
    }

    await stageScreenings(snapshot.id, "ebillet", normalized);
    const rows = normalized.map((screening) =>
      toPromotionRow(screening, movieIdByRef.get(screening.sourceMovieRef)!),
    );
    const outcome = await promoteCinema({
      snapshotId: snapshot.id,
      source: "ebillet",
      cinemaId,
      rows,
    });

    const counts = { cinemas: 1, movies: groups.length, showtimes: rows.length };
    const { error: statusError } = await supabaseAdmin
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
    if (statusError) throw new Error(`organizer status: ${statusError.message}`);

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
  } catch (err) {
    const message = errorMessage(err);
    await markSnapshotFailed(snapshot.id, message);
    await supabaseAdmin
      .from("ebillet_organizers")
      .update({
        last_synced_at: nowIso(),
        last_sync_status: "failed",
        last_sync_error: message.slice(0, 500),
      })
      .eq("id", organizerId);
    throw err;
  }
}
