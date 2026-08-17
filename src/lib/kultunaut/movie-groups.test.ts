import { describe, expect, it } from "vitest";
import { buildKultunautMovieGroups } from "./movie-groups";
import type { ParsedMovie } from "./parser.server";

const movie = (over: Partial<ParsedMovie> = {}): ParsedMovie => ({
  external_id: "m1",
  title: "Dune",
  original_title: null,
  runtime: 0,
  genre: [],
  year: 2021,
  director: "",
  rating: "",
  synopsis: "",
  poster: { a: "", b: "", c: "", d: "" },
  ...over,
});

describe("buildKultunautMovieGroups", () => {
  it("groups duplicate source records only when title and known year agree", () => {
    const groups = buildKultunautMovieGroups([
      movie({ external_id: "m1", title: "Dune", year: 2021 }),
      movie({ external_id: "m2", title: "Dune (2021)", year: 2021 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.externalIds).toEqual(["m1", "m2"]);
  });

  it("keeps remakes separate", () => {
    const groups = buildKultunautMovieGroups([
      movie({ external_id: "old", year: 1984 }),
      movie({ external_id: "new", year: 2021 }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("keeps same-title unknown-year records separate", () => {
    const groups = buildKultunautMovieGroups([
      movie({ external_id: "a", year: 0 }),
      movie({ external_id: "b", year: 0 }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("selects the richest metadata row as the group's presentation source", () => {
    const groups = buildKultunautMovieGroups([
      movie({ external_id: "thin" }),
      movie({
        external_id: "rich",
        runtime: 155,
        director: "Denis Villeneuve",
        synopsis: "A sufficiently long synopsis that carries useful metadata.",
        poster: { a: "poster.jpg", b: "", c: "", d: "" },
      }),
    ]);
    expect(groups[0]?.primary.external_id).toBe("rich");
  });
});
