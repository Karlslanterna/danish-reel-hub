import { parseKultunautXml } from "./parser.server";

export type ImportResult = {
  movies: { upserted: number };
  cinemas: { upserted: number };
  showtimes: { upserted: number };
  errors: string[];
};

const idFor = (prefix: string, externalId: string) => `${prefix}-${externalId}`;

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[æø]/g, (c) => (c === "æ" ? "ae" : "oe"))
    .replace(/å/g, "aa")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";


/**
 * Import a Kultunaut XML payload into Lovable Cloud.
 *
 * Uses the service-role client so it bypasses RLS — callers are responsible
 * for authenticating the request (see /api/public/kultunaut-import).
 *
 * Upsert keys:
 *   - movies.id    = "kn-" + movie.movieId
 *   - cinemas.id   = "kn-" + theater.theaterId
 *   - showtimes are matched on (movie_id, cinema_id, date, hall, start_time)
 *     so re-importing the same feed is idempotent.
 */
export async function importKultunautXml(xml: string): Promise<ImportResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const parsed = parseKultunautXml(xml);

  const errors: string[] = [];

  // --- Deduplicate movies that share the same title -------------------
  // Some Kultunaut entries appear multiple times (different external IDs)
  // for the same film. Keep the most complete profile and remap showtimes
  // from the discarded ones to the canonical entry.
  const titleKey = (title: string) => slugify(title);

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

  // Group parsed movies by normalized title and pick a canonical external_id.
  const byTitle = new Map<string, string[]>();
  for (const m of parsed.movies.values()) {
    const k = titleKey(m.title);
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

  // Movies --------------------------------------------------------------
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


  if (movieRows.length > 0) {
    const { error } = await supabaseAdmin
      .from("movies")
      .upsert(movieRows, { onConflict: "id" });
    if (error) errors.push(`movies: ${error.message}`);
  }

  // Merge pre-existing DB duplicates sharing this title into the canonical
  // entry: re-point their showtimes, then delete the duplicate movie row.
  for (const m of movieRows) {
    const canonicalId = m.id;
    const { data: dupes } = await supabaseAdmin
      .from("movies")
      .select("id")
      .ilike("title", m.title)
      .neq("id", canonicalId);
    if (!dupes || dupes.length === 0) continue;
    for (const dup of dupes) {
      const { error: updErr } = await supabaseAdmin
        .from("showtimes")
        .update({ movie_id: canonicalId })
        .eq("movie_id", dup.id);
      if (updErr) {
        errors.push(`merge showtimes ${dup.id}->${canonicalId}: ${updErr.message}`);
        continue;
      }
      const { error: delErr } = await supabaseAdmin
        .from("movies")
        .delete()
        .eq("id", dup.id);
      if (delErr) errors.push(`delete duplicate movie ${dup.id}: ${delErr.message}`);
    }
  }

  // Cinemas -------------------------------------------------------------
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


  if (cinemaRows.length > 0) {
    const { error } = await supabaseAdmin
      .from("cinemas")
      .upsert(cinemaRows, { onConflict: "id" });
    if (error) errors.push(`cinemas: ${error.message}`);
  }

  // Showtimes -----------------------------------------------------------
  // Group by (movie, cinema, date, hall) so multiple <time> entries collapse
  // into the array column `times`.
  type StKey = string;
  const grouped = new Map<
    StKey,
    {
      movie_id: string;
      cinema_id: string;
      date: string;
      hall: string;
      // time -> ticket_url (per-time URL preserved so each chip links to its own showing)
      timeUrls: Map<string, string | null>;
    }
  >();

  for (const st of parsed.showtimes) {
    const canonicalExt = remapExternal.get(st.movie_external_id) ?? st.movie_external_id;
    const movieKnownId = idFor("kn", canonicalExt);
    const cinemaKnownId = idFor("kn", st.cinema_external_id);
    const key = `${movieKnownId}|${cinemaKnownId}|${st.date}|${st.hall}`;
    const existing = grouped.get(key);
    const target = existing ?? {
      movie_id: movieKnownId,
      cinema_id: cinemaKnownId,
      date: st.date,
      hall: st.hall,
      timeUrls: new Map<string, string | null>(),
    };
    for (const t of st.times) {
      // Prefer the first non-empty URL seen for a given time.
      if (!target.timeUrls.get(t) && st.ticket_url) target.timeUrls.set(t, st.ticket_url);
      else if (!target.timeUrls.has(t)) target.timeUrls.set(t, st.ticket_url);
    }
    if (!existing) grouped.set(key, target);
  }

  let showtimesUpserted = 0;
  for (const row of grouped.values()) {
    if (!parsed.movies.has(row.movie_id.replace(/^kn-/, ""))) {
      const { data } = await supabaseAdmin
        .from("movies")
        .select("id")
        .eq("id", row.movie_id)
        .maybeSingle();
      if (!data) {
        errors.push(`showtime skipped: movie ${row.movie_id} not found`);
        continue;
      }
    }
    if (!parsed.cinemas.has(row.cinema_id.replace(/^kn-/, ""))) {
      const { data } = await supabaseAdmin
        .from("cinemas")
        .select("id")
        .eq("id", row.cinema_id)
        .maybeSingle();
      if (!data) {
        errors.push(`showtime skipped: cinema ${row.cinema_id} not found`);
        continue;
      }
    }

    const times = Array.from(row.timeUrls.keys()).sort();
    const ticketUrls = times.map((t) => row.timeUrls.get(t) ?? "");
    const primaryTicketUrl = ticketUrls.find((u) => u) ?? null;
    const startTimeIso = times[0]
      ? new Date(`${row.date}T${times[0]}`).toISOString()
      : null;

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
          times,
          ticket_url: primaryTicketUrl,
          ticket_urls: ticketUrls,
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
        times,
        ticket_url: primaryTicketUrl,
        ticket_urls: ticketUrls,
        booking_url: primaryTicketUrl,
        start_time: startTimeIso,
      });
      if (error) {
        errors.push(`showtime insert: ${error.message}`);
        continue;
      }
    }
    showtimesUpserted++;
  }

  return {
    movies: { upserted: movieRows.length },
    cinemas: { upserted: cinemaRows.length },
    showtimes: { upserted: showtimesUpserted },
    errors,
  };
}
