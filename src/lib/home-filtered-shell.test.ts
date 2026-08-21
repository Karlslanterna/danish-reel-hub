import { describe, expect, it } from "vitest";
import type { Cinema, Movie, ShowtimeIndexRow } from "./cinema-data";
import {
  buildChildrenHomeShell,
  buildSpecialEventHomeShell,
  type HomeCatalogData,
} from "./home-catalog";
import { compactShowtimeIndex, expandShowtimeIndex } from "./public-catalog";
import { specialEventMovies } from "./special-event-seo";

const movie = (id: string, genre: string[] = ["Drama"]): Movie => ({
  id,
  slug: id,
  title: `Film ${id}`,
  runtime: 100,
  genre,
  year: 2026,
  director: "",
  rating: "",
  synopsis: "",
  poster: {},
  screeningCount: 10,
  nextScreeningDate: "2026-08-22",
});

const cinema = (n: number): Cinema => ({
  id: `c${n}`,
  slug: `c${n}`,
  name: `Biograf ${n}`,
  city: "København",
  address: "",
  description: "",
  screens: 1,
  website: "",
  latitude: 55.67,
  longitude: 12.56,
});

const screening = (
  movieId: string,
  events: string[] = [],
  cinemaId = "c1",
): ShowtimeIndexRow => ({
  movieId,
  cinemaId,
  date: "2026-08-22",
  times: ["18:00"],
  formats: [],
  languages: [],
  events,
});

const catalog = (movies: Movie[], rows: ShowtimeIndexRow[]): HomeCatalogData => ({
  movies,
  cinemas: Array.from({ length: 30 }, (_, index) => cinema(index + 1)),
  showtimeIndex: compactShowtimeIndex(rows),
  complete: true,
  totalMovies: movies.length,
  totalCinemas: 30,
});

describe("filtered landing shells", () => {
  it("serializes only the first 12 correctly classified child movies and no showtime history", () => {
    const childMovies = Array.from({ length: 14 }, (_, index) => movie(`child-${index + 1}`, ["Familie"]));
    const adult = movie("adult", ["Drama"]);
    const full = catalog(
      [...childMovies, adult],
      [...childMovies.map((item) => screening(item.id)), screening(adult.id)],
    );

    const shell = buildChildrenHomeShell(full);

    expect(shell.complete).toBe(false);
    expect(shell.totalMovies).toBe(14);
    expect(shell.movies).toHaveLength(12);
    expect(shell.movies.every((item) => item.id.startsWith("child-"))).toBe(true);
    expect(expandShowtimeIndex(shell.showtimeIndex)).toEqual([]);
    expect(shell.cinemas).toHaveLength(24);
    expect(shell.totalCinemas).toBe(30);
  });

  it("selects only explicitly tagged special-event movies without serializing their 30-day rows", () => {
    const baby = movie("baby");
    const baby2 = movie("baby-2");
    const regular = movie("regular");
    const full = catalog(
      [baby, baby2, regular],
      [
        screening(baby.id, ["Babybio"]),
        screening(baby.id, [], "c2"),
        screening(baby2.id, ["Babybio"], "c3"),
        screening(regular.id),
      ],
    );

    const shell = buildSpecialEventHomeShell(full, "Babybio");

    expect(shell.complete).toBe(false);
    expect(shell.totalMovies).toBe(2);
    expect(shell.movies.map((item) => item.id)).toEqual(["baby", "baby-2"]);
    expect(expandShowtimeIndex(shell.showtimeIndex)).toEqual([]);
    // Head/JSON-LD must still use the server-validated bounded set even though
    // the browser payload no longer includes the showtime history.
    expect(specialEventMovies(shell, "Babybio").map((item) => item.id)).toEqual([
      "baby",
      "baby-2",
    ]);
  });
});
