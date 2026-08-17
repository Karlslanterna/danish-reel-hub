import { describe, expect, it } from "vitest";
import {
  buildEbilletMovieSupplementPatch,
  sourceRefsForMovieGroup,
  type ExistingMovieMetadata,
} from "./movie-metadata";
import type { EbilletMovieGroup } from "./normalize";

const existing = (over: Partial<ExistingMovieMetadata> = {}): ExistingMovieMetadata => ({
  year: 0,
  runtime: 0,
  synopsis: "",
  director: "",
  genre: [],
  poster: {},
  trailer_url: null,
  ebillet_movie_base_id: null,
  ebillet_movie_ids: [],
  ...over,
});

const group = (over: Partial<EbilletMovieGroup> = {}): EbilletMovieGroup => ({
  ref: "base-10",
  baseId: 10,
  movieIds: [100, 101],
  title: "Dune",
  originalTitle: "Dune",
  runtime: 155,
  year: 2021,
  genres: ["Science Fiction"],
  director: "Denis Villeneuve",
  rating: "11",
  synopsis: "Beskrivelse",
  posterUrl: "https://example.com/poster.jpg",
  trailerUrl: "https://example.com/trailer",
  ...over,
});

describe("buildEbilletMovieSupplementPatch", () => {
  it("fills missing metadata and source identity", () => {
    expect(buildEbilletMovieSupplementPatch(existing(), group())).toMatchObject({
      year: 2021,
      runtime: 155,
      synopsis: "Beskrivelse",
      director: "Denis Villeneuve",
      genre: ["Science Fiction"],
      trailer_url: "https://example.com/trailer",
      poster: { url: "https://example.com/poster.jpg" },
      ebillet_movie_base_id: 10,
      ebillet_movie_ids: [100, 101],
    });
  });

  it("never overwrites useful existing metadata", () => {
    const patch = buildEbilletMovieSupplementPatch(
      existing({
        year: 1984,
        runtime: 137,
        synopsis: "Eksisterende synopsis",
        director: "Eksisterende instruktør",
        genre: ["Drama"],
        poster: { url: "https://existing/poster.jpg" },
        trailer_url: "https://existing/trailer",
      }),
      group(),
    );
    expect(patch).not.toHaveProperty("year");
    expect(patch).not.toHaveProperty("runtime");
    expect(patch).not.toHaveProperty("synopsis");
    expect(patch).not.toHaveProperty("director");
    expect(patch).not.toHaveProperty("genre");
    expect(patch).not.toHaveProperty("poster");
    expect(patch).not.toHaveProperty("trailer_url");
  });

  it("merges newly observed concrete eBillet movie ids", () => {
    const patch = buildEbilletMovieSupplementPatch(
      existing({ ebillet_movie_base_id: 10, ebillet_movie_ids: [100] }),
      group({ movieIds: [100, 102] }),
    );
    expect(patch.ebillet_movie_ids).toEqual([100, 102]);
  });
});

describe("sourceRefsForMovieGroup", () => {
  it("persists both base and concrete movie identities", () => {
    expect(sourceRefsForMovieGroup(group())).toEqual(["base-10", "movie-100", "movie-101"]);
  });

  it("does not duplicate a version-only ref", () => {
    expect(sourceRefsForMovieGroup(group({ ref: "movie-100", baseId: null, movieIds: [100] }))).toEqual([
      "movie-100",
    ]);
  });
});
