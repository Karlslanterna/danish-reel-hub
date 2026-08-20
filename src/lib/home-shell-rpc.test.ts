import { beforeEach, describe, expect, it, vi } from "vitest";

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };

const rpcCalls: Array<{ name: string; args: unknown }> = [];
const fromCalls: string[] = [];
let rpcResult: RpcResult = { data: [], error: null };
let tableResult: { data: unknown; error: unknown; count: number | null } = {
  data: [],
  error: null,
  count: null,
};

const tableBuilder = () => {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ["select", "gt", "lte", "order", "range", "in", "eq"]) {
    builder[method] = vi.fn(chain);
  }
  builder.returns = vi.fn(async () => tableResult);
  return builder;
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return { returns: async () => rpcResult };
    },
    from: (table: string) => {
      fromCalls.push(table);
      return tableBuilder();
    },
  },
}));

const movieRow = (id: string, count: number, total: number) => ({
  id,
  slug: id,
  title: `Film ${id}`,
  original_title: null,
  runtime: 100,
  genre: ["Drama"],
  year: 2026,
  director: "Instruktør",
  rating: "t.o.11",
  poster: { url: "https://example.com/p.jpg" },
  release_date: null,
  tmdb_id: null,
  tmdb_runtime: null,
  tmdb_genres: [],
  tmdb_poster_url: null,
  tmdb_director: null,
  screening_count: count,
  next_screening_date: "2026-08-20",
  total_count: total,
});

describe("fetchTopMovies", () => {
  beforeEach(() => {
    rpcCalls.length = 0;
    fromCalls.length = 0;
    rpcResult = { data: [], error: null };
    tableResult = { data: [], error: null, count: null };
    vi.resetModules();
  });

  it("uses the bounded RPC and maps its rows plus the cheap total", async () => {
    rpcResult = { data: [movieRow("a", 12, 612), movieRow("b", 5, 612)], error: null };
    const { fetchTopMovies } = await import("./cinema-data");

    const result = await fetchTopMovies(2);

    expect(rpcCalls).toEqual([{ name: "get_home_shell_movies", args: { p_limit: 2 } }]);
    expect(fromCalls).toEqual([]);
    expect(result.total).toBe(612);
    expect(result.movies.map((movie) => movie.id)).toEqual(["a", "b"]);
    expect(result.movies[0].screeningCount).toBe(12);
  });

  it("falls back to movies_ranked only when the function is not deployed yet", async () => {
    rpcResult = {
      data: null,
      error: { code: "PGRST202", message: "Could not find the function in the schema cache" },
    };
    tableResult = { data: [movieRow("a", 3, 0)], error: null, count: 1 };
    const { fetchTopMovies } = await import("./cinema-data");

    const result = await fetchTopMovies(5);

    expect(fromCalls).toContain("movies_ranked");
    expect(result.movies.map((movie) => movie.id)).toEqual(["a"]);
    expect(result.total).toBe(1);
  });

  it("propagates real RPC errors instead of silently re-querying", async () => {
    rpcResult = { data: null, error: { code: "57014", message: "canceling statement" } };
    const { fetchTopMovies } = await import("./cinema-data");

    await expect(fetchTopMovies(5)).rejects.toMatchObject({ code: "57014" });
    expect(fromCalls).toEqual([]);
  });
});
