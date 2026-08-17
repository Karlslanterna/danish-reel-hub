import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ParsedCinema, ParsedMovie } from "./parser.server";
import { buildKultunautMovieGroups } from "./movie-groups";
import { loadEbilletOwnedCinemaIds } from "./authority.server";
import {
  clearUnresolved,
  loadRefs,
  recordUnresolved,
  upsertRefs,
  type RefInput,
} from "@/lib/pipeline/identity.server";

const SOURCE = "kultunaut" as const;
const idFor = (externalId: string) => `kn-${externalId}`;

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[æø]/g, (c) => (c === "æ" ? "ae" : "oe"))
    .replace(/å/g, "aa")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

type ExistingCinema = {
  id: string;
  slug: string;
  source: string;
};

type ExistingMovie = {
  id: string;
  slug: string;
  source: string;
  title: string;
  original_title: string | null;
  runtime: number;
  genre: string[];
  year: number;
  director: string;
  rating: string;
  synopsis: string;
  poster: Record<string, unknown> | null;
};

const chunk = <T>(items: T[], size = 300): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

async function existingCinemas(ids: string[]): Promise<Map<string, ExistingCinema>> {
  const rows: ExistingCinema[] = [];
  for (const idsChunk of chunk([...new Set(ids)])) {
    if (idsChunk.length === 0) continue;
    const { data, error } = await supabaseAdmin
      .from("cinemas")
      .select("id,slug,source")
      .in("id", idsChunk);
    if (error) throw new Error(`cinema identity lookup: ${error.message}`);
    rows.push(...((data ?? []) as ExistingCinema[]));
  }
  return new Map(rows.map((row) => [row.id, row]));
}

async function existingMovies(ids: string[]): Promise<Map<string, ExistingMovie>> {
  const rows: ExistingMovie[] = [];
  for (const idsChunk of chunk([...new Set(ids)])) {
    if (idsChunk.length === 0) continue;
    const { data, error } = await supabaseAdmin
      .from("movies")
      .select("id,slug,source,title,original_title,runtime,genre,year,director,rating,synopsis,poster")
      .in("id", idsChunk);
    if (error) throw new Error(`movie identity lookup: ${error.message}`);
    rows.push(...((data ?? []) as ExistingMovie[]));
  }
  return new Map(rows.map((row) => [row.id, row]));
}

async function uniqueSlug(
  table: "cinemas" | "movies",
  baseInput: string,
  externalId: string,
): Promise<string> {
  const base = slugify(baseInput) || `${table === "cinemas" ? "biograf" : "film"}-${slugify(externalId)}`;
  const candidates = [base, `${base}-${slugify(externalId)}`];
  const { data, error } = await supabaseAdmin
    .from(table)
    .select("slug")
    .in("slug", candidates);
  if (error) throw new Error(`${table} slug lookup: ${error.message}`);
  const taken = new Set((data ?? []).map((row) => row.slug));
  const free = candidates.find((candidate) => !taken.has(candidate));
  if (free) return free;

  for (let suffix = 2; suffix < 100; suffix++) {
    const candidate = `${base}-${slugify(externalId)}-${suffix}`;
    const { data: hit, error: hitError } = await supabaseAdmin
      .from(table)
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (hitError) throw new Error(`${table} slug lookup: ${hitError.message}`);
    if (!hit) return candidate;
  }
  throw new Error(`Kunne ikke finde unik slug for ${baseInput}`);
}

export type CinemaResolution = {
  canonicalByExternal: Map<string, string>;
  canonicalRowsWritten: number;
  skippedEbilletOwned: number;
};

/**
 * Resolve Kultunaut theater ids before metadata writes. Existing source refs
 * always win, which prevents a future feed from silently creating a second
 * canonical row for an already-mapped theater.
 */
export async function resolveKultunautCinemas(
  cinemas: Iterable<ParsedCinema>,
): Promise<CinemaResolution> {
  const list = [...cinemas];
  const externalIds = list.map((cinema) => cinema.external_id);
  const refs = await loadRefs(SOURCE, "cinema", externalIds);
  const canonicalByExternal = new Map<string, string>();

  for (const cinema of list) {
    canonicalByExternal.set(
      cinema.external_id,
      refs.get(cinema.external_id)?.canonicalId ?? idFor(cinema.external_id),
    );
  }

  const existing = await existingCinemas([...canonicalByExternal.values()]);
  const ebilletOwned = await loadEbilletOwnedCinemaIds();
  const refWrites: RefInput[] = [];
  let canonicalRowsWritten = 0;
  let skippedEbilletOwned = 0;

  for (const cinema of list) {
    const canonicalId = canonicalByExternal.get(cinema.external_id)!;
    refWrites.push({
      source: SOURCE,
      entityType: "cinema",
      externalId: cinema.external_id,
      canonicalId,
      matchMethod: refs.has(cinema.external_id) ? "external_id" : "created",
      confidence: 1,
      locked: true,
    });

    // eBillet owns venue metadata and screenings once linked. Kultunaut keeps
    // its identity alias but performs no canonical venue write.
    if (ebilletOwned.has(canonicalId)) {
      skippedEbilletOwned += 1;
      continue;
    }

    const current = existing.get(canonicalId);
    const slug = current?.slug ?? (await uniqueSlug("cinemas", cinema.name, cinema.external_id));
    const row = {
      id: canonicalId,
      slug,
      external_id: cinema.external_id,
      name: cinema.name,
      city: cinema.city,
      address: cinema.address,
      description: cinema.description,
      screens: cinema.screens,
      latitude: cinema.latitude,
      longitude: cinema.longitude,
      source: SOURCE,
    };
    const { error } = await supabaseAdmin
      .from("cinemas")
      .upsert(row as never, { onConflict: "id" });
    if (error) throw new Error(`cinema ${cinema.external_id}: ${error.message}`);
    canonicalRowsWritten += 1;
  }

  const written = await upsertRefs(refWrites);
  if (written.conflicts.length > 0) {
    await recordUnresolved(
      written.conflicts.map((conflict) => ({
        source: SOURCE,
        entityType: "cinema" as const,
        externalId: conflict.split(":")[0]?.split("/").pop() ?? "unknown",
        label: conflict,
        reason: "locked cinema ref conflict",
      })),
    );
    throw new Error(`Kultunaut cinema identity conflict: ${written.conflicts[0]}`);
  }
  await clearUnresolved(SOURCE, "cinema", externalIds);
  return { canonicalByExternal, canonicalRowsWritten, skippedEbilletOwned };
}

function sourceMoviePatch(current: ExistingMovie, movie: ParsedMovie): Record<string, unknown> {
  if (current.source === SOURCE || current.id.startsWith("kn-")) {
    return {
      title: movie.title,
      original_title: movie.original_title,
      runtime: movie.runtime,
      genre: movie.genre,
      year: movie.year,
      director: movie.director,
      rating: movie.rating,
      synopsis: movie.synopsis,
      poster: movie.poster,
    };
  }

  // A canonical film can be shared with another source. Kultunaut then only
  // fills blanks; it never overwrites useful existing source metadata.
  const patch: Record<string, unknown> = {};
  if (!current.original_title && movie.original_title) patch.original_title = movie.original_title;
  if ((!current.runtime || current.runtime <= 0) && movie.runtime > 0) patch.runtime = movie.runtime;
  if ((current.genre ?? []).length === 0 && movie.genre.length > 0) patch.genre = movie.genre;
  if ((!current.year || current.year <= 0) && movie.year > 0) patch.year = movie.year;
  if (!current.director.trim() && movie.director.trim()) patch.director = movie.director;
  if (!current.rating.trim() && movie.rating.trim()) patch.rating = movie.rating;
  if (!current.synopsis.trim() && movie.synopsis.trim()) patch.synopsis = movie.synopsis;
  const hasPoster = Object.values(current.poster ?? {}).some(
    (value) => typeof value === "string" && value.trim() !== "",
  );
  const hasIncomingPoster = Object.values(movie.poster).some((value) => value && value.trim() !== "");
  if (!hasPoster && hasIncomingPoster) patch.poster = movie.poster;
  return patch;
}

export type MovieResolution = {
  canonicalByExternal: Map<string, string>;
  canonicalRowsWritten: number;
  unresolvedExternalIds: string[];
};

/**
 * Resolve source movie ids conservatively. A known source ref is immutable;
 * duplicate source rows may share a canonical film only when normalized title
 * and a known year agree. Conflicting persisted refs are parked for review.
 */
export async function resolveKultunautMovies(
  movies: Iterable<ParsedMovie>,
): Promise<MovieResolution> {
  const list = [...movies];
  const groups = buildKultunautMovieGroups(list);
  const externalIds = list.map((movie) => movie.external_id);
  const refs = await loadRefs(SOURCE, "movie", externalIds);
  const canonicalByExternal = new Map<string, string>();
  const unresolvedExternalIds: string[] = [];

  type Work = { primary: ParsedMovie; externalIds: string[]; canonicalId: string };
  const work: Work[] = [];

  for (const group of groups) {
    const mappedIds = [
      ...new Set(
        group.externalIds
          .map((externalId) => refs.get(externalId)?.canonicalId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (mappedIds.length > 1) {
      unresolvedExternalIds.push(...group.externalIds);
      await recordUnresolved(
        group.externalIds.map((externalId) => ({
          source: SOURCE,
          entityType: "movie" as const,
          externalId,
          label: group.primary.title,
          reason: "same title/year group points to multiple locked canonical movies",
          payload: { canonicalIds: mappedIds },
        })),
      );
      continue;
    }

    const canonicalId = mappedIds[0] ?? idFor(group.primary.external_id);
    for (const externalId of group.externalIds) canonicalByExternal.set(externalId, canonicalId);
    work.push({ primary: group.primary, externalIds: group.externalIds, canonicalId });
  }

  const existing = await existingMovies(work.map((item) => item.canonicalId));
  const refWrites: RefInput[] = [];
  let canonicalRowsWritten = 0;

  for (const item of work) {
    const current = existing.get(item.canonicalId);
    if (current) {
      const patch = sourceMoviePatch(current, item.primary);
      if (Object.keys(patch).length > 0) {
        const { error } = await supabaseAdmin
          .from("movies")
          .update(patch as never)
          .eq("id", item.canonicalId);
        if (error) throw new Error(`movie ${item.primary.external_id}: ${error.message}`);
        canonicalRowsWritten += 1;
      }
    } else {
      const slug = await uniqueSlug("movies", item.primary.title, item.primary.external_id);
      const { error } = await supabaseAdmin.from("movies").insert({
        id: item.canonicalId,
        slug,
        external_id: item.primary.external_id,
        title: item.primary.title,
        original_title: item.primary.original_title,
        runtime: item.primary.runtime,
        genre: item.primary.genre,
        year: item.primary.year,
        director: item.primary.director,
        rating: item.primary.rating,
        synopsis: item.primary.synopsis,
        poster: item.primary.poster,
        source: SOURCE,
      } as never);
      if (error) throw new Error(`movie ${item.primary.external_id}: ${error.message}`);
      canonicalRowsWritten += 1;
    }

    for (const externalId of item.externalIds) {
      refWrites.push({
        source: SOURCE,
        entityType: "movie",
        externalId,
        canonicalId: item.canonicalId,
        matchMethod: refs.has(externalId) ? "external_id" : item.externalIds.length > 1 ? "deterministic" : "created",
        confidence: 1,
        locked: true,
        notes: item.externalIds.length > 1 ? "same normalized title and known year" : undefined,
      });
    }
  }

  const written = await upsertRefs(refWrites);
  if (written.conflicts.length > 0) {
    await recordUnresolved(
      written.conflicts.map((conflict) => ({
        source: SOURCE,
        entityType: "movie" as const,
        externalId: conflict.split(":")[0]?.split("/").pop() ?? "unknown",
        label: conflict,
        reason: "locked movie ref conflict",
      })),
    );
    throw new Error(`Kultunaut movie identity conflict: ${written.conflicts[0]}`);
  }

  await clearUnresolved(
    SOURCE,
    "movie",
    [...canonicalByExternal.keys()].filter((externalId) => !unresolvedExternalIds.includes(externalId)),
  );
  return { canonicalByExternal, canonicalRowsWritten, unresolvedExternalIds };
}
