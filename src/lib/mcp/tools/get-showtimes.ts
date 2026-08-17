import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { getSupabase } from "../supabase";

export default defineTool({
  name: "get_showtimes",
  title: "Get showtimes",
  description:
    "List physical cinema screenings filtered by movie id/slug, cinema id/slug, and/or date (YYYY-MM-DD). At least one filter is required.",
  inputSchema: {
    movie_id: z.string().optional().describe("Movie id."),
    movie_slug: z.string().optional().describe("Movie slug."),
    cinema_id: z.string().optional().describe("Cinema id."),
    cinema_slug: z.string().optional().describe("Cinema slug."),
    date: z.string().optional().describe("Local Danish date in YYYY-MM-DD."),
    limit: z.number().int().min(1).max(200).optional().describe("Max results (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ movie_id, movie_slug, cinema_id, cinema_slug, date, limit }) => {
    const supabase = getSupabase();

    let resolvedMovieId = movie_id;
    if (!resolvedMovieId && movie_slug) {
      const { data } = await supabase.from("movies").select("id").eq("slug", movie_slug).maybeSingle();
      resolvedMovieId = data?.id;
    }
    let resolvedCinemaId = cinema_id;
    if (!resolvedCinemaId && cinema_slug) {
      const { data } = await supabase.from("cinemas").select("id").eq("slug", cinema_slug).maybeSingle();
      resolvedCinemaId = data?.id;
    }

    if (!resolvedMovieId && !resolvedCinemaId && !date) {
      return {
        content: [
          {
            type: "text",
            text: "Provide at least one of movie_id/movie_slug, cinema_id/cinema_slug, or date.",
          },
        ],
        isError: true,
      };
    }

    let q = supabase
      .from("screenings")
      .select(
        "id, source, source_ref, starts_at, local_date, local_time, hall, ticket_url, price_min, price_max, free_seats, formats, languages, events, movie_id, cinema_id",
      )
      .order("starts_at", { ascending: true })
      .limit(limit ?? 50);
    if (resolvedMovieId) q = q.eq("movie_id", resolvedMovieId);
    if (resolvedCinemaId) q = q.eq("cinema_id", resolvedCinemaId);
    if (date) q = q.eq("local_date", date);

    const { data, error } = await q;
    if (error) {
      return {
        content: [{ type: "text", text: "Could not load showtimes." }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { showtimes: data ?? [] },
    };
  },
});
