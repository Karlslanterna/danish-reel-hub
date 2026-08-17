import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ParsedMovie } from "./parser.server";
import { chooseContinuityCandidate, type ContinuityCandidateMovie } from "./movie-continuity";
import { loadRefs } from "@/lib/pipeline/identity.server";

const PAGE_SIZE = 1000;
const chunk = <T>(items: T[], size = 200): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

type CandidateRow = {
  id: string;
  title: string;
  original_title: string | null;
  genre: string[] | null;
  runtime: number | null;
  year: number | null;
  tmdb_id: number | null;
  ebillet_movie_base_id: number | null;
  ebillet_movie_ids: number[] | null;
};

async function activeMovieIds(): Promise<string[]> {
  const ids = new Set<string>();
  const now = new Date().toISOString();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from("screenings")
      .select("movie_id")
      .gte("starts_at", now)
      .order("starts_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`continuity active screening lookup: ${error.message}`);
    const page = (data ?? []) as Array<{ movie_id: string }>;
    for (const row of page) ids.add(row.movie_id);
    if (page.length < PAGE_SIZE) break;
  }
  return [...ids];
}

async function candidateMovies(ids: string[]): Promise<ContinuityCandidateMovie[]> {
  const out: ContinuityCandidateMovie[] = [];
  for (const idChunk of chunk([...new Set(ids)])) {
    if (idChunk.length === 0) continue;
    const { data, error } = await supabaseAdmin
      .from("movies")
      .select(
        "id,title,original_title,genre,runtime,year,tmdb_id,ebillet_movie_base_id,ebillet_movie_ids",
      )
      .in("id", idChunk);
    if (error) throw new Error(`continuity movie lookup: ${error.message}`);
    for (const row of (data ?? []) as CandidateRow[]) {
      out.push({
        id: row.id,
        title: row.title,
        originalTitle: row.original_title,
        genres: row.genre ?? [],
        runtime: row.runtime,
        year: row.year,
        tmdbId: row.tmdb_id,
        ebilletBaseId: row.ebillet_movie_base_id,
        ebilletMovieIds: row.ebillet_movie_ids,
      });
    }
  }
  return out;
}

export type KultunautContinuityResolution = {
  /** Safe per-run destination. Existing locked refs are never mutated here. */
  canonicalOverrides: Map<string, string>;
  /** Old canonical ids displaced by a safe runtime override. */
  displacedCanonicalIds: string[];
};

/**
 * Find a safer canonical destination for a Kultunaut source movie when exactly
 * one active strong title/year/genre-compatible film exists.
 *
 * Crucially, this function is READ-ONLY with respect to source_entity_refs.
 * Locked identity mappings are a database safety invariant and are never
 * silently unlocked or repointed by an importer. The caller may use an
 * override for this snapshot; brand-new refs can later be persisted normally.
 */
export async function resolveKultunautMovieContinuity(
  movies: Iterable<ParsedMovie>,
): Promise<KultunautContinuityResolution> {
  const list = [...movies];
  const canonicalOverrides = new Map<string, string>();
  if (list.length === 0) return { canonicalOverrides, displacedCanonicalIds: [] };

  const [refs, activeIds] = await Promise.all([
    loadRefs(
      "kultunaut",
      "movie",
      list.map((movie) => movie.external_id),
    ),
    activeMovieIds(),
  ]);
  const candidates = await candidateMovies(activeIds);
  const displaced = new Set<string>();

  for (const incoming of list) {
    const current = refs.get(incoming.external_id);
    const decision = chooseContinuityCandidate({
      incomingTitle: incoming.title,
      incomingYear: incoming.year,
      incomingGenres: incoming.genre,
      incomingRuntime: incoming.runtime,
      currentCanonicalId: current?.canonicalId ?? null,
      candidates,
    });
    if (!decision || decision.canonicalId === current?.canonicalId) continue;

    canonicalOverrides.set(incoming.external_id, decision.canonicalId);
    if (current?.canonicalId) displaced.add(current.canonicalId);
  }

  return { canonicalOverrides, displacedCanonicalIds: [...displaced] };
}
