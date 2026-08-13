import {
  getMovieDetails,
  imageUrl,
  isTmdbConfigured,
  searchMovies,
  TmdbUnavailableError,
  type TmdbMovieDetails,
} from "./client.server";
import {
  isNonFilmEvent,
  pickMatch,
  searchQueries,
  type MatchCandidate,
  type MatchOutcome,
} from "./match";

export type EnrichSummary = {
  processed: number;
  matched: number;
  skipped: number;
  remaining: number;
  disabled: boolean;
  errors: string[];
};

/** Re-check a confirmed match every 30 days, a skipped film every 7. */
const MATCHED_TTL_DAYS = 30;
const SKIPPED_TTL_DAYS = 7;

type MovieRow = {
  id: string;
  title: string;
  original_title: string | null;
  year: number | null;
  tmdb_status: string | null;
};

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

async function selectWork(db: any, limit: number): Promise<{ rows: MovieRow[]; remaining: number }> {
  const cols = "id, title, original_title, year, tmdb_status";

  // 1) never attempted
  const { data: pending, error: pErr } = await db
    .from("movies")
    .select(cols)
    .eq("tmdb_status", "pending")
    .order("id")
    .limit(limit);
  if (pErr) throw new Error(pErr.message);

  const rows: MovieRow[] = [...((pending ?? []) as MovieRow[])];

  // 2) stale refreshes
  if (rows.length < limit) {
    const { data: stale, error: sErr } = await db
      .from("movies")
      .select(cols)
      .neq("tmdb_status", "pending")
      .or(
        `and(tmdb_status.eq.matched,tmdb_fetched_at.lt.${daysAgo(MATCHED_TTL_DAYS)}),` +
          `and(tmdb_status.eq.skipped,tmdb_fetched_at.lt.${daysAgo(SKIPPED_TTL_DAYS)})`,
      )
      .order("tmdb_fetched_at", { ascending: true })
      .limit(limit - rows.length);
    if (sErr) throw new Error(sErr.message);
    rows.push(...((stale ?? []) as MovieRow[]));
  }

  const { count } = await db
    .from("movies")
    .select("id", { count: "exact", head: true })
    .eq("tmdb_status", "pending");

  return { rows, remaining: Math.max(0, (count ?? 0) - rows.length) };
}

function trailerUrl(details: TmdbMovieDetails): string | null {
  const vids = details.videos?.results ?? [];
  const yt = vids.filter((v) => v.site === "YouTube" && v.key);
  const pick =
    yt.find((v) => v.type === "Trailer" && v.official) ??
    yt.find((v) => v.type === "Trailer") ??
    yt.find((v) => v.type === "Teaser");
  return pick ? `https://www.youtube.com/watch?v=${pick.key}` : null;
}

function buildUpdate(details: TmdbMovieDetails) {
  const director =
    (details.credits?.crew ?? []).find((c) => (c.job ?? "").toLowerCase() === "director")?.name ?? null;
  const cast = (details.credits?.cast ?? [])
    .slice(0, 10)
    .map((c) => ({ name: c.name, character: c.character ?? null, profile_path: c.profile_path ?? null }));

  return {
    tmdb_id: details.id,
    tmdb_runtime: details.runtime && details.runtime > 0 ? details.runtime : null,
    tmdb_overview: details.overview && details.overview.trim() ? details.overview.trim() : null,
    tmdb_genres: (details.genres ?? []).map((g) => g.name).filter(Boolean),
    tmdb_poster_url: imageUrl(details.poster_path, "w500"),
    tmdb_backdrop_url: imageUrl(details.backdrop_path, "w1280"),
    tmdb_trailer_url: trailerUrl(details),
    tmdb_cast: cast,
    tmdb_director: director,
    tmdb_vote_average:
      typeof details.vote_average === "number" && details.vote_average > 0 ? details.vote_average : null,
    tmdb_fetched_at: new Date().toISOString(),
    tmdb_status: "matched",
    tmdb_skip_reason: null,
  };
}

/**
 * Enrich up to `limit` films with TMDb metadata.
 *
 * Never throws for per-film problems: a film that cannot be matched with high
 * confidence is marked `skipped` with a reason and left on Kultunaut data.
 * If TMDb is unconfigured or unavailable the batch returns early and the
 * import continues unchanged.
 */
export async function enrichBatch(limit = 20): Promise<EnrichSummary> {
  const empty: EnrichSummary = {
    processed: 0,
    matched: 0,
    skipped: 0,
    remaining: 0,
    disabled: false,
    errors: [],
  };

  if (!isTmdbConfigured()) {
    return { ...empty, disabled: true, errors: ["TMDb er ikke konfigureret (TMDB_API_KEY mangler)"] };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  let work: { rows: MovieRow[]; remaining: number };
  try {
    work = await selectWork(supabaseAdmin, limit);
  } catch (err) {
    return { ...empty, errors: [`TMDb udvælgelse: ${err instanceof Error ? err.message : String(err)}`] };
  }

  const summary: EnrichSummary = { ...empty, remaining: work.remaining };

  for (const movie of work.rows) {
    try {
      const year = movie.year && movie.year > 1880 ? movie.year : null;

      // Non-film listings (Børnebiffen, playbacks, lectures…) never exist on
      // TMDb — skip them without spending API calls.
      let outcome: MatchOutcome = isNonFilmEvent(movie.title)
        ? { matched: false, reason: "ikke en film (arrangement)" }
        : { matched: false, reason: "ingen TMDb-resultater" };

      if (!isNonFilmEvent(movie.title)) {
        // Extra search passes: feed title, embedded original title, DB
        // original_title, and known Danish aliases. Scoring stays unchanged.
        for (const query of searchQueries(movie.title, movie.original_title)) {
          let candidates = (await searchMovies(query, year ?? undefined)) as MatchCandidate[];
          if (candidates.length === 0 && year) {
            candidates = (await searchMovies(query)) as MatchCandidate[];
          }
          const attempt = pickMatch(query, year, candidates);
          outcome = attempt;
          if (attempt.matched) break;
        }
      }
      if (!outcome.matched) {
        await supabaseAdmin
          .from("movies")
          .update({
            tmdb_status: "skipped",
            tmdb_skip_reason: outcome.reason.slice(0, 200),
            tmdb_fetched_at: new Date().toISOString(),
          })
          .eq("id", movie.id);
        summary.skipped++;
        summary.errors.push(`TMDb sprang over "${movie.title}": ${outcome.reason}`);
        summary.processed++;
        continue;
      }

      const details = await getMovieDetails(outcome.id);
      if (!details) {
        await supabaseAdmin
          .from("movies")
          .update({
            tmdb_status: "skipped",
            tmdb_skip_reason: "TMDb-detaljer ikke fundet",
            tmdb_fetched_at: new Date().toISOString(),
          })
          .eq("id", movie.id);
        summary.skipped++;
        summary.processed++;
        continue;
      }

      const { error } = await supabaseAdmin.from("movies").update(buildUpdate(details)).eq("id", movie.id);
      if (error) {
        summary.errors.push(`TMDb gem "${movie.title}": ${error.message}`);
      } else {
        summary.matched++;
      }
      summary.processed++;
    } catch (err) {
      if (err instanceof TmdbUnavailableError) {
        // Whole-service problem: stop this batch, leave the rest for next run.
        summary.errors.push(`TMDb utilgængelig: ${err.message}`);
        summary.disabled = true;
        break;
      }
      summary.errors.push(
        `TMDb "${movie.title}": ${err instanceof Error ? err.message : String(err)}`,
      );
      summary.processed++;
    }
  }

  summary.errors = summary.errors.slice(-50);
  return summary;
}
