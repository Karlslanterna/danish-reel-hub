import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { Movie } from "@/lib/cinema-data";
import { findCachedHomeMovie, HOME_CATALOG_QUERY_KEY } from "@/lib/home-catalog-cache";

const movie = (slug: string, sourceSlugs?: string[]): Movie => ({
  id: slug,
  slug,
  title: slug,
  runtime: 90,
  genre: [],
  year: 2026,
  director: "",
  rating: "",
  synopsis: "",
  poster: {},
  sourceSlugs,
});

describe("home catalog cache", () => {
  it("reuses a homepage movie for a film route", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(HOME_CATALOG_QUERY_KEY, {
      movies: [movie("canonical", ["canonical", "source-version"])],
    });

    expect(findCachedHomeMovie(queryClient, "source-version")?.slug).toBe("canonical");
    expect(findCachedHomeMovie(queryClient, "missing")).toBeNull();
  });
});
