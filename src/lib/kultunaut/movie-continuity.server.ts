import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ParsedMovie } from "./parser.server";
import { chooseContinuityCandidate, type ContinuityCandidateMovie } from "./movie-continuity";
import { loadRefs } from "@/lib/pipeline/identity.server";

const PAGE_SIZE = 1000;
const chunk = <T>(items: T[], size = 75): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const slotKey = (row: { cinema_id: string; local_date: string; local_time: string }) =>
  `${row.cinema_id}|${row.local_date}|${String(row.local_time).slice(0, 5)}`;

type ScreeningSlot = {
  movie_id: string;
  cinema_id: string;
  local_date: string;
  local_time: string;
};

type CandidateRow = {
  id: string;
  title: string;
  original_title: string | null;
  year: number | null;
  tmdb_id: number | null;
  ebillet_movie_base_id: number | null;
  ebillet_movie_ids: number[] | null;
};

async function screeningRowsForMovieIds(movieIds: string[]): Promise<ScreeningSlot[]> {
  const rows: ScreeningSlot[] = [];
  for (const ids of chunk([...new Set(movieIds)])) {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabaseAdmin
        .from("screenings")
        .select("movie_id,cinema_id,local_date,local_time")
        .in("movie_id", ids)
        .order("starts_at", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`continuity screening lookup: ${error.message}`);
      const page = (data ?? []) as ScreeningSlot[];
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
  }
  return rows;
}

async function screeningRowsForCinemas(
  cinemaIds: string[],
  firstDate: string,
  lastDate: string,
): Promise<ScreeningSlot[]> {
  const rows: ScreeningSlot[] = [];
  for (const ids of chunk([...new Set(cinemaIds)], 50)) {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabaseAdmin
        .from("screenings")
        .select("movie_id,cinema_id,local_date,local_time")
        .in("cinema_id", ids)
        .gte("local_date", firstDate)
        .lte("local_date", lastDate)
        .order("starts_at", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`continuity cinema lookup: ${error.message}`);
      const page = (data ?? []) as ScreeningSlot[];
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
  }
  return rows;
}

async function candidateMovies(ids: string[]): Promise<ContinuityCandidateMovie[]> {
  const out: ContinuityCandidateMovie[] = [];
  for (const idChunk of chunk([...new Set(ids)], 200)) {
    if (idChunk.length === 0) continue;
    const { data, error } = await supabaseAdmin
      .from("movies")
      .select("id,title,original_title,year,tmdb_id,ebillet_movie_base_id,ebillet_movie_ids")
      .in("id", idChunk);
    if (error) throw new Error(`continuity movie lookup: ${error.message}`);
    for (const row of (data ?? []) as CandidateRow[]) {
      out.push({
        id: row.id,
        title: row.title,
        originalTitle: row.original_title,
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
 * Repair already-mapped Kultunaut movie ids when the source has changed id for
 * the same physical film. This intentionally overrides a locked Kultunaut ref,
 * but only after repeated exact cinema/date/time overlaps select one strong
 * canonical anchor. It never uses title alone.
 *
 * A brand-new source id has no historical screenings yet and is left alone;
 * if it turns out to be duplicate, the next snapshot can repair it from the
 * now-observable continuity evidence. This keeps first-seen identity cautious.
 */
export async function repairMappedKultunautMovieContinuity(
  movies: Iterable<ParsedMovie>,
): Promise<{ rebound: number; displacedCanonicalIds: string[] }> {
  const list = [...movies];
  if (list.length === 0) return { rebound: 0, displacedCanonicalIds: [] };

  const refs = await loadRefs(
    "kultunaut",
    "movie",
    list.map((movie) => movie.external_id),
  );
  const mapped = list.filter((movie) => refs.has(movie.external_id));
  if (mapped.length === 0) return { rebound: 0, displacedCanonicalIds: [] };

  const currentIds = [...new Set(mapped.map((movie) => refs.get(movie.external_id)!.canonicalId))];
  const ownRows = await screeningRowsForMovieIds(currentIds);
  if (ownRows.length === 0) return { rebound: 0, displacedCanonicalIds: [] };

  const firstDate = ownRows.reduce((min, row) => (row.local_date < min ? row.local_date : min), ownRows[0]!.local_date);
  const lastDate = ownRows.reduce((max, row) => (row.local_date > max ? row.local_date : max), ownRows[0]!.local_date);
  const allRows = await screeningRowsForCinemas(
    [...new Set(ownRows.map((row) => row.cinema_id))],
    firstDate,
    lastDate,
  );

  const moviesAtSlot = new Map<string, Set<string>>();
  for (const row of allRows) {
    const key = slotKey(row);
    const set = moviesAtSlot.get(key) ?? new Set<string>();
    set.add(row.movie_id);
    moviesAtSlot.set(key, set);
  }
  const candidateIds = [...new Set(allRows.map((row) => row.movie_id))];
  const candidates = await candidateMovies(candidateIds);

  let rebound = 0;
  const displaced = new Set<string>();
  for (const incoming of mapped) {
    const current = refs.get(incoming.external_id)!;
    const slots = ownRows.filter((row) => row.movie_id === current.canonicalId);
    const decision = chooseContinuityCandidate({
      incomingTitle: incoming.title,
      incomingYear: incoming.year,
      currentCanonicalId: current.canonicalId,
      totalSlots: slots.length,
      slotCandidates: slots.map((row) => [...(moviesAtSlot.get(slotKey(row)) ?? [])]),
      candidates,
    });
    if (!decision || decision.canonicalId === current.canonicalId) continue;

    const { error } = await supabaseAdmin
      .from("source_entity_refs")
      .update({
        canonical_id: decision.canonicalId,
        match_method: "deterministic",
        confidence: 1,
        locked: true,
        notes: `verified screening continuity: ${decision.evidence} exact overlaps`,
      })
      .eq("source", "kultunaut")
      .eq("entity_type", "movie")
      .eq("external_id", incoming.external_id)
      .eq("canonical_id", current.canonicalId);
    if (error) throw new Error(`continuity ref repair ${incoming.external_id}: ${error.message}`);

    displaced.add(current.canonicalId);
    rebound += 1;
  }

  return { rebound, displacedCanonicalIds: [...displaced] };
}
