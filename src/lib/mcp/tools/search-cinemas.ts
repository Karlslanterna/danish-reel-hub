import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { getSupabase } from "../supabase";

export default defineTool({
  name: "search_cinemas",
  title: "Search cinemas",
  description:
    "Search Lanterna's cinema directory by name or filter by city. Returns cinemas with id, slug, name, city, address, and screens.",
  inputSchema: {
    query: z.string().optional().describe("Case-insensitive substring to match against the cinema name."),
    city: z.string().optional().describe("Case-insensitive city filter (exact match)."),
    limit: z.number().int().min(1).max(100).optional().describe("Max results (default 20)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, city, limit }) => {
    const supabase = getSupabase();
    let q = supabase
      .from("cinemas")
      .select("id, slug, name, city, address, screens, website")
      .limit(limit ?? 20);
    if (query) q = q.ilike("name", `%${query}%`);
    if (city) q = q.ilike("city", city);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { cinemas: data ?? [] },
    };
  },
});
