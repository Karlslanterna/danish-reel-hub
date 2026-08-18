import { describe, expect, it } from "vitest";
import { buildFilterFacets } from "./filter-facets";

const movies = [
  { id: "family", genre: ["Animation", "Familie"] },
  { id: "drama", genre: ["Drama"] },
];
const rows = [
  {
    movieId: "family",
    cinemaId: "a",
    date: "2026-08-20",
    times: ["10:00"],
    formats: ["2D"],
    languages: ["Dansk tale"],
    events: ["Babybio"],
  },
  {
    movieId: "drama",
    cinemaId: "b",
    date: "2026-08-21",
    times: ["21:30"],
    formats: ["3D"],
    languages: ["Danske undertekster"],
    events: ["Filmporten"],
  },
];

describe("filter facets", () => {
  it("only offers values compatible with every other active dimension", () => {
    const facets = buildFilterFacets(rows, movies, {
      genre: "Familie",
      language: "Dansk tale",
    });
    expect(facets.dates).toEqual(["2026-08-20"]);
    expect(facets.times).toEqual(["morning"]);
    expect(facets.formats).toEqual(["2D"]);
    expect(facets.events).toEqual(["Babybio"]);
    expect([...facets.cinemaIds]).toEqual(["a"]);
  });

  it("ignores its own selected dimension so an active value remains removable", () => {
    const facets = buildFilterFacets(rows, movies, { format: "3D", date: "2026-08-20" });
    expect(facets.formats).toEqual(["2D"]);
    expect(facets.dates).toEqual(["2026-08-21"]);
  });

  it("supports a pre-classified child or route movie set", () => {
    const facets = buildFilterFacets(rows, movies, { baseMovieIds: new Set(["family"]) });
    expect(facets.genres).toEqual(["Animation", "Familie"]);
    expect(facets.events).toEqual(["Babybio"]);
  });
});
