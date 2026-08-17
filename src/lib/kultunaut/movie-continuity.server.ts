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

/**
 * Bind Kultunaut ids to an already-active canonical film only when exactly one
 * strong title/year/genre-compatible candidate exists. This can repair an old
 * weak mapping and can prevent a brand-new source id from creating a duplicate.
 * Locked refs are overridden only by this explicit deterministic rule.
 */
export async function repairMappedKultunautMovieContinuity(
  movies: Iterable<ParsedMovie>,
): Promise<{ rebound: number; displacedCanonicalIds: string[] }> {
  const list = [...movies];
  if (list.length === 0) return { rebound: 0, displacedCanonicalIds: [] };

  const [refs, activeIds] = await Promise.all([
    loadRefs(
      "kultunaut",
      "movie",
      list.map((movie) => movie.external_id),
    ),
    activeMovieIds(),
  ]);
  const candidates = await candidateMovies(activeIds);

  let rebound = 0;
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

    const { error } = await supabaseAdmin.from("source_entity_refs").upsert(
      {
        source: "kultunaut",
        entity_type: "movie",
        external_id: incoming.external_id,
        canonical_id: decision.canonicalId,
        match_method: "deterministic",
        confidence: 1,
        locked: true,
        notes: "unique active title/year/genre continuity anchor",
      },
      { onConflict: "source,entity_type,external_id" },
    );
    if (error) throw new Error(`continuity ref repair ${incoming.external_id}: ${error.message}`);

    if (current?.canonicalId) displaced.add(current.canonicalId);
    rebound += 1;
  }

  return { rebound, displacedCanonicalIds: [...displaced] };
}
