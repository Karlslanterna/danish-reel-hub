import { describe, expect, it } from "vitest";
import { MOVIE_LISTING_COLUMNS, mapCinemaRows } from "./cinema-data";
import { HOME_SHELL_CINEMA_COUNT, HOME_SHELL_MOVIE_COUNT } from "./home-catalog";

describe("bounded listing reads", () => {
  it("never requests the detail-only movie columns", () => {
    const columns = MOVIE_LISTING_COLUMNS.split(",").map((column) => column.trim());
    for (const heavy of [
      "*",
      "synopsis",
      "tmdb_overview",
      "tmdb_cast",
      "tmdb_backdrop_url",
      "tmdb_trailer_url",
      "trailer_url",
    ]) {
      expect(columns).not.toContain(heavy);
    }
    // The cards and the ranking still need these.
    for (const required of ["id", "slug", "title", "poster", "screening_count"]) {
      expect(columns).toContain(required);
    }
  });

  it("keeps the shell sized to what the homepage actually paints", () => {
    expect(HOME_SHELL_MOVIE_COUNT).toBe(20);
    expect(HOME_SHELL_CINEMA_COUNT).toBe(24);
  });
});

describe("mapCinemaRows", () => {
  it("consolidates source rows and tolerates omitted listing columns", () => {
    const cinemas = mapCinemaRows([
      {
        id: "a",
        slug: "nordisk-film-biografer-aarhus",
        name: "Nordisk Film Biografer Aarhus",
        city: "8000 Aarhus C",
        latitude: 56.1,
        longitude: 10.2,
        website: null,
      },
      {
        id: "b",
        slug: "borup-kino",
        name: "Borup Kino",
        city: "4140 Borup",
        latitude: null,
        longitude: null,
        website: "https://borupkino.dk",
      },
    ]);

    expect(cinemas.map((cinema) => cinema.name)).toEqual([
      "Borup Kino",
      "Nordisk Film Biografer Aarhus",
    ]);
    for (const cinema of cinemas) {
      expect(cinema.description).toBe("");
      expect(Number.isFinite(cinema.screens)).toBe(true);
    }
  });
});
