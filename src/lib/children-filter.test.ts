import { describe, expect, it } from "vitest";
import { isMovieForChildren } from "./children-filter";

const movie = (overrides: Partial<{ title: string; genre: string[]; rating: string }> = {}) => ({
  title: "En film",
  genre: [],
  rating: "",
  ...overrides,
});

const screening = (events: string[] = [], languages: string[] = []) => ({ events, languages });

describe("isMovieForChildren", () => {
  it("includes animation and family genres from both Danish and TMDb data", () => {
    expect(isMovieForChildren(movie({ genre: ["Tegnefilm/Animation"] }))).toBe(true);
    expect(isMovieForChildren(movie({ genre: ["Family"] }))).toBe(true);
  });

  it("includes explicit child programmes and Danish dubbed age-rated films", () => {
    expect(isMovieForChildren(movie({ title: "Børnebiffen" }))).toBe(true);
    expect(
      isMovieForChildren(movie({ rating: "Tilladt for børn over 7 år" }), [
        screening([], ["Dansk tale"]),
      ]),
    ).toBe(true);
  });

  it("does not classify a general-audience drama from its age rating alone", () => {
    expect(isMovieForChildren(movie({ genre: ["Drama"], rating: "Tilladt for alle" }))).toBe(false);
  });

  it("always excludes films marked 15+, even when their genre is animation", () => {
    expect(isMovieForChildren(movie({ genre: ["Animation"], rating: "Tilladt over 15 år" }))).toBe(
      false,
    );
    expect(isMovieForChildren(movie({ genre: ["Familiefilm"], rating: "t.o.15" }))).toBe(false);
  });
});
