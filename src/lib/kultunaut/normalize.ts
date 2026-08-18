/**
 * Pure normalization of parsed Kultunaut data into pipeline shapes.
 *
 * Kultunaut has no per-screening id, so identity is derived deterministically
 * from the source-native tuple (theater, movie, date, time, hall). The same
 * feed therefore always produces the same `sourceRef`, which makes repeated
 * imports idempotent.
 */
import { createHash } from "crypto";
import type { ParsedShowtime } from "./parser.server";
import { copenhagenToUtcIso } from "@/lib/pipeline/localtime";
import type { NormalizedScreening } from "@/lib/pipeline/types";
import { normalizeTicketUrl } from "@/lib/screening-read-model";

/** Stable per-screening identity within the Kultunaut source. */
export function kultunautScreeningRef(input: {
  cinemaExternalId: string;
  movieExternalId: string;
  date: string;
  time: string;
  hall: string;
}): string {
  const key = [
    input.cinemaExternalId,
    input.movieExternalId,
    input.date,
    input.time,
    input.hall,
  ].join("|");
  return `kn-${createHash("sha1").update(key).digest("hex").slice(0, 24)}`;
}

const TIME_RE = /^\d{2}:\d{2}$/;

/** One row per physical screening — `times[]` is exploded here. */
export function normalizeKultunautScreenings(showtimes: ParsedShowtime[]): NormalizedScreening[] {
  const out = new Map<string, NormalizedScreening>();
  for (const st of showtimes) {
    if (!st.cinema_external_id || !st.movie_external_id) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(st.date)) continue;
    const hall = (st.hall ?? "").trim();
    st.times.forEach((rawTime, index) => {
      const time = (rawTime ?? "").trim();
      if (!TIME_RE.test(time)) return;
      let startsAt: string;
      try {
        startsAt = copenhagenToUtcIso(st.date, time);
      } catch {
        return;
      }
      const ref = kultunautScreeningRef({
        cinemaExternalId: st.cinema_external_id,
        movieExternalId: st.movie_external_id,
        date: st.date,
        time,
        hall,
      });
      const ticketUrl = Array.isArray((st as { ticket_urls?: string[] }).ticket_urls)
        ? ((st as { ticket_urls?: string[] }).ticket_urls?.[index] ?? st.ticket_url ?? null)
        : (st.ticket_url ?? null);
      out.set(ref, {
        sourceRef: ref,
        sourceCinemaRef: st.cinema_external_id,
        sourceMovieRef: st.movie_external_id,
        startsAt,
        localDate: st.date,
        localTime: time,
        hall,
        ticketUrl: normalizeTicketUrl(ticketUrl),
        priceMin: null,
        priceMax: null,
        freeSeats: null,
        formats: st.formats ?? [],
        languages: st.languages ?? [],
        events: st.events ?? [],
      });
    });
  }
  return [...out.values()].sort(
    (a, b) => a.startsAt.localeCompare(b.startsAt) || a.sourceRef.localeCompare(b.sourceRef),
  );
}
