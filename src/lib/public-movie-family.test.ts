import { describe, expect, it } from "vitest";
import {
  buildPublicMovieFamilies,
  canSharePublicMovieFamily,
  publicMovieTitleKey,
} from "./public-movie-family";

describe("public movie families", () => {
  it("normalizes only screening presentation suffixes", () => {
    expect(publicMovieTitleKey("Biler - Dansk Tale")).toBe("biler");
    expect(publicMovieTitleKey("Dobbeltfejl - Med danske undertekster")).toBe("dobbeltfejl");
    expect(publicMovieTitleKey("The Witch - Event - Fright Night")).toBe("the witch event fright night");
  });

  it("merges exact same current film across sources", () => {
    expect(
      canSharePublicMovieFamily(
        { id: "eb", title: "Autofiktion", year: 2026, genres: ["Drama"], tmdbId: 1088548 },
        { id: "kn", title: "Autofiktion", year: 2026, genres: ["Drama"] },
      ),
    ).toBe(true);
  });

  it("accepts a one-year source disagreement for the same current title", () => {
    expect(
      canSharePublicMovieFamily(
        { id: "eb", title: "Lyset i os", year: 2026, genres: ["Drama"] },
        { id: "kn", title: "Lyset i os", year: 2025, genres: ["Drama"] },
      ),
    ).toBe(true);
  });

  it("does not merge remakes with conflicting known years", () => {
    expect(
      canSharePublicMovieFamily(
        { id: "new", title: "Gummi Tarzan", year: 2022, genres: ["Familiefilm"] },
        { id: "old", title: "Gummi Tarzan", year: 1981, genres: ["Familiefilm"] },
      ),
    ).toBe(false);
  });

  it("merges unknown-year duplicates only when title has metadata evidence", () => {
    expect(
      canSharePublicMovieFamily(
        { id: "a", title: "The Odyssey", year: 0, genres: ["Action", "Drama"] },
        { id: "b", title: "The odyssey", year: 0, genres: ["Action", "Drama"] },
      ),
    ).toBe(true);
    expect(
      canSharePublicMovieFamily(
        { id: "a", title: "One Night Only", year: 0, genres: [] },
        { id: "b", title: "One Night Only", year: 0, genres: [] },
      ),
    ).toBe(false);
  });

  it("uses identical TMDb identity even when source titles differ", () => {
    expect(
      canSharePublicMovieFamily(
        { id: "a", title: "Paw Patrol: Dino Filmen", year: 2026, tmdbId: 1185806 },
        { id: "b", title: "Paw Patrol: The Dino Movie - ensk tala", year: 2026, tmdbId: 1185806 },
      ),
    ).toBe(true);
  });

  it("chooses the strongest representative and exposes every member id", () => {
    const index = buildPublicMovieFamilies([
      { id: "kn", title: "Dobbeltfejl", year: 2026, genres: ["Drama"], screeningCount: 50 },
      { id: "eb", title: "Dobbeltfejl", year: 2026, genres: ["Drama"], tmdbId: 1481651, screeningCount: 7 },
      { id: "other", title: "Gummi Tarzan", year: 1981, genres: ["Familiefilm"], screeningCount: 1 },
    ]);

    expect(index.canonicalByMember.get("kn")).toBe("eb");
    expect(index.canonicalByMember.get("eb")).toBe("eb");
    expect(index.membersByCanonical.get("eb")).toEqual(["eb", "kn"]);
    expect(index.canonicalByMember.get("other")).toBe("other");
  });
});
