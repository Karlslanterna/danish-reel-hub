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

  // Movies --------------------------------------------------------------
  const movieRows = Array.from(parsed.movies.values()).map((m) => ({
    id: idFor("kn", m.external_id),
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

  // Cinemas -------------------------------------------------------------
  const cinemaRows = Array.from(parsed.cinemas.values()).map((c) => ({
    id: idFor("kn", c.external_id),
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
      times: Set<string>;
      ticket_url: string | null;
    }
  >();

  for (const st of parsed.showtimes) {
    const movieKnownId = idFor("kn", st.movie_external_id);
    const cinemaKnownId = idFor("kn", st.cinema_external_id);
    const key = `${movieKnownId}|${cinemaKnownId}|${st.date}|${st.hall}`;
    const existing = grouped.get(key);
    if (existing) {
      st.times.forEach((t) => existing.times.add(t));
      if (!existing.ticket_url && st.ticket_url) existing.ticket_url = st.ticket_url;
    } else {
      grouped.set(key, {
        movie_id: movieKnownId,
        cinema_id: cinemaKnownId,
        date: st.date,
        hall: st.hall,
        times: new Set(st.times),
        ticket_url: st.ticket_url,
      });
    }
  }

  let showtimesUpserted = 0;
  for (const row of grouped.values()) {
    // Skip showtimes that reference unknown movies/cinemas. The DB has FK
    // constraints (cinema_id, movie_id) so an unknown reference would 500.
    if (!parsed.movies.has(row.movie_id.replace(/^kn-/, ""))) {
      // movie wasn't in this XML — verify it exists in the DB before insert
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

    const times = Array.from(row.times).sort();
    const startTimeIso = times[0]
      ? new Date(`${row.date}T${times[0]}`).toISOString()
      : null;

    // Match an existing showtime on (movie, cinema, date, hall) to keep this
    // import idempotent without relying on a DB unique constraint.
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
          ticket_url: row.ticket_url,
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
        ticket_url: row.ticket_url,
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
