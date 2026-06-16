import { parseKultunautXml } from "./parser.server";

export type ImportResult = {
  movies: { upserted: number };
  cinemas: { upserted: number };
  showtimes: { upserted: number };
  errors: string[];
};

export type JobStatus = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  phase: string;
  total_movies: number;
  total_cinemas: number;
  total_showtimes: number;
  processed_movies: number;
  processed_cinemas: number;
  processed_showtimes: number;
  errors: string[];
  message: string | null;
  created_at: string;
  updated_at: string;
};

const SHOWTIME_BATCH_SIZE = 100;

const idFor = (prefix: string, externalId: string) => `${prefix}-${externalId}`;

// Strip a trailing year in brackets, e.g. "Michael (2025)" -> "Michael".
// Handles parentheses, square brackets, and surrounding whitespace.
const stripYearSuffix = (title: string): string =>
  title.replace(/\s*[\(\[]\s*(?:19|20)\d{2}\s*[\)\]]\s*$/u, "").trim();

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[æø]/g, (c) => (c === "æ" ? "ae" : "oe"))
    .replace(/å/g, "aa")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";

type GroupedShowtime = {
  movie_id: string;
  cinema_id: string;
  date: string;
  hall: string;
  times: string[];
  ticket_urls: string[];
};

type JobPayload = {
  groupedShowtimes: GroupedShowtime[];
};

/**
 * Create a queued import job from a Kultunaut XML payload.
 * Returns the new job id immediately; processing happens in subsequent
 * calls to processJobBatch().
 */
export async function createImportJob(xml: string): Promise<{ jobId: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("import_jobs")
    .insert({ source: "kultunaut", status: "queued", phase: "pending", xml })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to create import job: ${error.message}`);
  return { jobId: data.id as string };
}

/**
 * Process the next chunk of work for a job. Idempotent: safe to call
 * repeatedly until status becomes "completed" or "failed".
 *
 * Phases (state machine):
 *   pending  -> parse + dedup + upsert all movies            -> cinemas
 *   cinemas  -> upsert all cinemas                            -> merge
 *   merge    -> merge DB-duplicate movies into canonical      -> showtimes-init
 *   showtimes-init -> build grouped showtimes payload         -> showtimes
 *   showtimes -> process SHOWTIME_BATCH_SIZE rows             -> showtimes | done
 *   done / failed
 */
export async function processJobBatch(
  jobId: string,
): Promise<{ done: boolean; status: string; phase: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: job, error: loadErr } = await supabaseAdmin
    .from("import_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (loadErr || !job) {
    throw new Error(`Job ${jobId} not found: ${loadErr?.message ?? "missing"}`);
  }
  if (job.status === "completed" || job.status === "failed") {
    return { done: true, status: job.status, phase: job.phase };
  }

  const pushErrors = async (errs: string[]) => {
    if (errs.length === 0) return;
    const merged = [...(job.errors ?? []), ...errs].slice(-200);
    await supabaseAdmin.from("import_jobs").update({ errors: merged }).eq("id", jobId);
    job.errors = merged;
  };

  const fail = async (message: string) => {
    await supabaseAdmin
      .from("import_jobs")
      .update({ status: "failed", message })
      .eq("id", jobId);
  };

  try {
    if (job.phase === "pending") {
      await supabaseAdmin
        .from("import_jobs")
        .update({ status: "running", message: "Parsing XML…" })
        .eq("id", jobId);

      const parsed = parseKultunautXml(job.xml);
      const errors: string[] = [];

      // Deduplicate movies by normalized title; keep the most complete profile.
      const scoreMovie = (m: {
        runtime: number;
        director: string;
        rating: string;
        synopsis: string;
        genre: string[];
        poster: { a: string; b: string; c: string; d: string; url?: string };
        original_title: string | null;
      }): number => {
        let s = 0;
        const posterVals = [m.poster.a, m.poster.b, m.poster.c, m.poster.d, m.poster.url];
        if (posterVals.some((v) => v && v.trim() !== "")) s += 10;
        if (m.runtime > 0) s += 5;
        if (m.synopsis && m.synopsis.trim().length > 20) s += 3;
        if (m.director && m.director.trim() !== "") s += 2;
        if (m.rating && m.rating.trim() !== "") s += 1;
        if (m.genre && m.genre.length > 0) s += 1;
        if (m.original_title && m.original_title.trim() !== "") s += 1;
        return s;
      };

      const byTitle = new Map<string, string[]>();
      for (const m of parsed.movies.values()) {
        const k = slugify(stripYearSuffix(m.title));
        const arr = byTitle.get(k) ?? [];
        arr.push(m.external_id);
        byTitle.set(k, arr);
      }
      const remapExternal = new Map<string, string>();
      for (const [, extIds] of byTitle) {
        if (extIds.length === 1) {
          remapExternal.set(extIds[0], extIds[0]);
          continue;
        }
        const ranked = extIds
          .map((eid) => ({ eid, m: parsed.movies.get(eid)! }))
          .sort((a, b) => scoreMovie(b.m) - scoreMovie(a.m));
        const canonical = ranked[0].eid;
        for (const { eid } of ranked) remapExternal.set(eid, canonical);
      }
      const canonicalExternalIds = new Set(remapExternal.values());

      const movieRows = Array.from(parsed.movies.values())
        .filter((m) => canonicalExternalIds.has(m.external_id))
        .map((m) => ({
          id: idFor("kn", m.external_id),
          slug: slugify(m.title) || `kn-${m.external_id}`,
          external_id: m.external_id,
          title: m.title,
          original_title: m.original_title,
          runtime: m.runtime,
          genre: m.genre,
          year: m.year,
          director: m.director,
          rating: m.rating,
          synopsis: m.synopsis,
          poster: m.poster,
        }));

      // Upsert movies in chunks to avoid huge single statements.
      const CHUNK = 500;
      for (let i = 0; i < movieRows.length; i += CHUNK) {
        const slice = movieRows.slice(i, i + CHUNK);
        const { error } = await supabaseAdmin
          .from("movies")
          .upsert(slice, { onConflict: "id" });
        if (error) errors.push(`movies chunk ${i}: ${error.message}`);
      }

      // Build grouped showtimes payload now (uses remap from this parse).
      const grouped = new Map<string, GroupedShowtime & { timeUrls: Map<string, string | null> }>();
      for (const st of parsed.showtimes) {
        const canonicalExt = remapExternal.get(st.movie_external_id) ?? st.movie_external_id;
        const movieKnownId = idFor("kn", canonicalExt);
        const cinemaKnownId = idFor("kn", st.cinema_external_id);
        const key = `${movieKnownId}|${cinemaKnownId}|${st.date}|${st.hall}`;
        const existing = grouped.get(key);
        const target =
          existing ??
          ({
            movie_id: movieKnownId,
            cinema_id: cinemaKnownId,
            date: st.date,
            hall: st.hall,
            times: [],
            ticket_urls: [],
            timeUrls: new Map<string, string | null>(),
          } as GroupedShowtime & { timeUrls: Map<string, string | null> });
        for (const t of st.times) {
          if (!target.timeUrls.get(t) && st.ticket_url) target.timeUrls.set(t, st.ticket_url);
          else if (!target.timeUrls.has(t)) target.timeUrls.set(t, st.ticket_url);
        }
        if (!existing) grouped.set(key, target);
      }
      const groupedShowtimes: GroupedShowtime[] = Array.from(grouped.values()).map((g) => {
        const times = Array.from(g.timeUrls.keys()).sort();
        const ticket_urls = times.map((t) => g.timeUrls.get(t) ?? "");
        return {
          movie_id: g.movie_id,
          cinema_id: g.cinema_id,
          date: g.date,
          hall: g.hall,
          times,
          ticket_urls,
        };
      });

      const payload: JobPayload = { groupedShowtimes };
      const cinemaRows = Array.from(parsed.cinemas.values()).map((c) => ({
        id: idFor("kn", c.external_id),
        slug: slugify(c.name) || `kn-${c.external_id}`,
        external_id: c.external_id,
        name: c.name,
        city: c.city,
        address: c.address,
        description: c.description,
        screens: c.screens,
        latitude: c.latitude,
        longitude: c.longitude,
      }));

      // Stash cinema rows + grouped showtimes for the next phases.
      await supabaseAdmin
        .from("import_jobs")
        .update({
          phase: "cinemas",
          total_movies: movieRows.length,
          total_cinemas: cinemaRows.length,
          total_showtimes: groupedShowtimes.length,
          processed_movies: movieRows.length,
          payload: { ...payload, cinemaRows, movieTitles: movieRows.map((m) => ({ id: m.id, title: m.title })) },
          message: "Upserted movies",
        })
        .eq("id", jobId);
      await pushErrors(errors);
      return { done: false, status: "running", phase: "cinemas" };
    }

    if (job.phase === "cinemas") {
      type CinemaRow = {
        id: string;
        slug: string;
        external_id: string;
        name: string;
        city: string;
        address: string;
        description: string;
        screens: number;
        latitude: number | null;
        longitude: number | null;
      };
      const payload = (job.payload ?? {}) as { cinemaRows?: CinemaRow[] };
      const cinemaRows = payload.cinemaRows ?? [];
      const errors: string[] = [];
      const CHUNK = 500;
      for (let i = 0; i < cinemaRows.length; i += CHUNK) {
        const slice = cinemaRows.slice(i, i + CHUNK);
        const { error } = await supabaseAdmin
          .from("cinemas")
          .upsert(slice, { onConflict: "id" });
        if (error) errors.push(`cinemas chunk ${i}: ${error.message}`);
      }
      await supabaseAdmin
        .from("import_jobs")
        .update({
          phase: "merge",
          processed_cinemas: cinemaRows.length,
          message: "Upserted cinemas",
        })
        .eq("id", jobId);
      await pushErrors(errors);
      return { done: false, status: "running", phase: "merge" };
    }

    if (job.phase === "merge") {
      const payload = (job.payload ?? {}) as {
        movieTitles?: Array<{ id: string; title: string }>;
      };
      const movieTitles = payload.movieTitles ?? [];
      const errors: string[] = [];

      // Merge DB duplicates sharing this title (ignoring trailing year suffix) into the canonical entry.
      const escapeLike = (s: string) => s.replace(/[\\%_,]/g, (c) => `\\${c}`);
      for (const m of movieTitles) {
        const base = stripYearSuffix(m.title);
        const baseEsc = escapeLike(base);
        const { data: dupes } = await supabaseAdmin
          .from("movies")
          .select("id,title")
          .or(`title.ilike.${baseEsc},title.ilike.${baseEsc} (%),title.ilike.${baseEsc} [%`)
          .neq("id", m.id);
        const realDupes = (dupes ?? []).filter(
          (d) => stripYearSuffix(d.title ?? "").toLowerCase() === base.toLowerCase(),
        );
        if (realDupes.length === 0) continue;
        for (const dup of realDupes) {
          const { error: updErr } = await supabaseAdmin
            .from("showtimes")
            .update({ movie_id: m.id })
            .eq("movie_id", dup.id);
          if (updErr) {
            errors.push(`merge showtimes ${dup.id}->${m.id}: ${updErr.message}`);
            continue;
          }
          const { error: delErr } = await supabaseAdmin
            .from("movies")
            .delete()
            .eq("id", dup.id);
          if (delErr) errors.push(`delete duplicate movie ${dup.id}: ${delErr.message}`);
        }
      }

      await supabaseAdmin
        .from("import_jobs")
        .update({ phase: "showtimes", message: "Processing showtimes…" })
        .eq("id", jobId);
      await pushErrors(errors);
      return { done: false, status: "running", phase: "showtimes" };
    }

    if (job.phase === "showtimes") {
      const payload = (job.payload ?? {}) as { groupedShowtimes?: GroupedShowtime[] };
      const grouped = payload.groupedShowtimes ?? [];
      const cursor = job.cursor ?? 0;
      const slice = grouped.slice(cursor, cursor + SHOWTIME_BATCH_SIZE);
      const errors: string[] = [];
      let upserted = job.processed_showtimes ?? 0;

      for (const row of slice) {
        const startTimeIso = row.times[0]
          ? new Date(`${row.date}T${row.times[0]}`).toISOString()
          : null;
        const primaryTicketUrl = row.ticket_urls.find((u) => u) ?? null;

        const { data: existing } = await supabaseAdmin
          .from("showtimes")
          .select("id")
          .eq("movie_id", row.movie_id)
          .eq("cinema_id", row.cinema_id)
          .eq("date", row.date)
          .eq("hall", row.hall)
          .maybeSingle();

        if (existing) {
          const { error } = await supabaseAdmin
            .from("showtimes")
            .update({
              times: row.times,
              ticket_url: primaryTicketUrl,
              ticket_urls: row.ticket_urls,
              booking_url: primaryTicketUrl,
              start_time: startTimeIso,
            })
            .eq("id", existing.id);
          if (error) {
            errors.push(`showtime update: ${error.message}`);
            continue;
          }
        } else {
          const { error } = await supabaseAdmin.from("showtimes").insert({
            movie_id: row.movie_id,
            cinema_id: row.cinema_id,
            date: row.date,
            hall: row.hall,
            times: row.times,
            ticket_url: primaryTicketUrl,
            ticket_urls: row.ticket_urls,
            booking_url: primaryTicketUrl,
            start_time: startTimeIso,
          });
          if (error) {
            errors.push(`showtime insert: ${error.message}`);
            continue;
          }
        }
        upserted++;
      }

      const newCursor = cursor + slice.length;
      const finished = newCursor >= grouped.length;

      await supabaseAdmin
        .from("import_jobs")
        .update({
          cursor: newCursor,
          processed_showtimes: upserted,
          phase: finished ? "done" : "showtimes",
          status: finished ? "completed" : "running",
          message: finished
            ? "Import completed"
            : `Showtimes ${newCursor}/${grouped.length}`,
        })
        .eq("id", jobId);
      await pushErrors(errors);
      return {
        done: finished,
        status: finished ? "completed" : "running",
        phase: finished ? "done" : "showtimes",
      };
    }

    // Unknown phase: mark done.
    return { done: true, status: job.status, phase: job.phase };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await fail(message);
    return { done: true, status: "failed", phase: job.phase };
  }
}

export async function getJobStatus(jobId: string): Promise<JobStatus | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("import_jobs")
    .select(
      "id, status, phase, total_movies, total_cinemas, total_showtimes, processed_movies, processed_cinemas, processed_showtimes, errors, message, created_at, updated_at",
    )
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as JobStatus) ?? null;
}
