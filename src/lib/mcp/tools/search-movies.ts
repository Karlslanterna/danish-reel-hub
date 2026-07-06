import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { getSupabase } from "../supabase";

export default defineTool({
  name: "search_movies",
  title: "Search movies",
  description:
    "Search Lanterna's movie catalog by title. Returns matching movies with id, slug, title, year, runtime, genre, and synopsis.",
  inputSchema: {
    query: z.string().min(1).describe("Case-insensitive substring to match against the movie title."),
    limit: z.number().int().min(1).max(50).optional().describe("Max results (default 10)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, limit }) => {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("movies")
      .select("id, slug, title, original_title, year, runtime, genre, rating, synopsis")
      .ilike("title", `%${query}%`)
      .limit(limit ?? 10);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { movies: data ?? [] },
    };
  },
});
