import { describe, expect, it } from "vitest";
import { movieIdentityKey, sameMovieIdentity } from "./movie-dedup";

describe("Kultunaut movie identity", () => {
  it("keeps same-title films from different years separate", () => {
    expect(movieIdentityKey({ title: "The Batman", year: 1966 })).not.toBe(
      movieIdentityKey({ title: "The Batman", year: 2022 }),
    );
  });

  it("treats a year in the title suffix as presentation noise when year is supplied", () => {
    expect(sameMovieIdentity({ title: "Michael (2025)", year: 2025 }, { title: "Michael", year: 2025 })).toBe(true);
  });

  it("does not merge an undated record into a dated record", () => {
    expect(sameMovieIdentity({ title: "Dune", year: null }, { title: "Dune", year: 2021 })).toBe(false);
  });

  it("normalizes accents and punctuation consistently", () => {
    expect(sameMovieIdentity({ title: "Amélie", year: 2001 }, { title: "Amelie", year: 2001 })).toBe(true);
  });
});
