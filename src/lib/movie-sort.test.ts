import { describe, expect, it } from "vitest";
import { sortConsolidatedMovies } from "./movie-sort";

describe("consolidated movie ordering", () => {
  it("sorts by the summed public screening count", () => {
    const movies = [
      { id: "a", title: "A", screeningCount: 248, nextScreeningDate: "2026-08-20" },
      { id: "b", title: "B", screeningCount: 412, nextScreeningDate: "2026-08-25" },
    ];
    expect(sortConsolidatedMovies(movies, "most-screenings").map((movie) => movie.id)).toEqual([
      "b",
      "a",
    ]);
  });

  it("uses next date and Danish title as stable tie breakers", () => {
    const movies = [
      { id: "late", title: "Åben", screeningCount: 4, nextScreeningDate: "2026-08-21" },
      { id: "early-z", title: "Zebra", screeningCount: 4, nextScreeningDate: "2026-08-20" },
      { id: "early-a", title: "Aben", screeningCount: 4, nextScreeningDate: "2026-08-20" },
    ];
    expect(sortConsolidatedMovies(movies, "most-screenings").map((movie) => movie.id)).toEqual([
      "early-a",
      "early-z",
      "late",
    ]);
  });
});
