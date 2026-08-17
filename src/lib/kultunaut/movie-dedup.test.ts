import { describe, expect, it } from "vitest";
import {
  kultunautMovieGroupKey,
  movieIdentityKey,
  sameMovieIdentity,
  validMovieYear,
} from "./movie-dedup";

describe("Kultunaut movie identity", () => {
  it("keeps same-title films from different years separate", () => {
    expect(movieIdentityKey({ title: "The Batman", year: 1966 })).not.toBe(
      movieIdentityKey({ title: "The Batman", year: 2022 }),
    );
  });

  it("treats a year in the title suffix as presentation noise when year is supplied", () => {
    expect(
      sameMovieIdentity(
        { title: "Michael (2025)", year: 2025 },
        { title: "Michael", year: 2025 },
      ),
    ).toBe(true);
  });

  it("does not merge an undated record into a dated record", () => {
    expect(sameMovieIdentity({ title: "Dune", year: null }, { title: "Dune", year: 2021 })).toBe(false);
  });

  it("treats zero as an unknown year", () => {
    expect(validMovieYear(0)).toBeNull();
    expect(movieIdentityKey({ title: "Dune", year: 0 })).toBe("dune|unknown");
  });

  it("does not auto-group two undated source records on title alone", () => {
    expect(kultunautMovieGroupKey({ title: "Dune", year: 0 }, "m1")).not.toBe(
      kultunautMovieGroupKey({ title: "Dune", year: 0 }, "m2"),
    );
  });

  it("groups source records only when normalized title and known year agree", () => {
    expect(kultunautMovieGroupKey({ title: "Amélie", year: 2001 }, "m1")).toBe(
      kultunautMovieGroupKey({ title: "Amelie", year: 2001 }, "m2"),
    );
  });

  it("normalizes accents and punctuation consistently", () => {
    expect(
      sameMovieIdentity({ title: "Amélie", year: 2001 }, { title: "Amelie", year: 2001 }),
    ).toBe(true);
  });
});
