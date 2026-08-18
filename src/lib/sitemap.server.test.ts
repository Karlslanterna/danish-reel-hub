import { describe, expect, it } from "vitest";
import type { Movie } from "./cinema-data";
import { canonicalMovieSlugMap } from "./sitemap.server";

const movie = (value: Partial<Movie> & Pick<Movie, "id" | "slug">): Movie => ({
  title: "Film",
  runtime: 0,
  genre: [],
  year: 0,
  director: "",
  rating: "",
  synopsis: "",
  poster: {},
  ...value,
});

describe("canonicalMovieSlugMap", () => {
  it("maps every source row to the canonical public slug", () => {
    const slugs = canonicalMovieSlugMap([
      movie({ id: "canonical", slug: "public-film", sourceIds: ["canonical", "source-b"] }),
      movie({ id: "single", slug: "single-film" }),
    ]);

    expect(Object.fromEntries(slugs)).toEqual({
      canonical: "public-film",
      "source-b": "public-film",
      single: "single-film",
    });
  });
});
