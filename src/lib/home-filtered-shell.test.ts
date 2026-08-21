import { describe, expect, it } from "vitest";
import type { Cinema, Movie, ShowtimeIndexRow } from "./cinema-data";
import {
  buildChildrenHomeShell,
  buildSpecialEventHomeShell,
  type HomeCatalogData,
} from "./home-catalog";
import { compactShowtimeIndex, expandShowtimeIndex } from "./public-catalog";

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
  it("serializes only the first 12 correctly classified child movies", () => {
    const childMovies = Array.from({ length: 14 }, (_, index) => movie(`child-${index + 1}`, ["Familie"]));
    const adult = movie("adult", ["Drama"]);
    const full = catalog(
      [...childMovies, adult],
      [...childMovies.map((item) => screening(item.id)), screening(adult.id)],
    );

    const shell = buildChildrenHomeShell(full);
    const rows = expandShowtimeIndex(shell.showtimeIndex);

    expect(shell.complete).toBe(false);
    expect(shell.totalMovies).toBe(14);
    expect(shell.movies).toHaveLength(12);
    expect(shell.movies.every((item) => item.id.startsWith("child-"))).toBe(true);
    expect(new Set(rows.map((row) => row.movieId))).toEqual(
      new Set(childMovies.slice(0, 12).map((item) => item.id)),
    );
    expect(shell.cinemas).toHaveLength(24);
    expect(shell.totalCinemas).toBe(30);
  });

  it("keeps only explicitly tagged rows on a special-event first paint", () => {
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
    const rows = expandShowtimeIndex(shell.showtimeIndex);

    expect(shell.complete).toBe(false);
    expect(shell.totalMovies).toBe(2);
    expect(shell.movies.map((item) => item.id)).toEqual(["baby", "baby-2"]);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.events.includes("Babybio"))).toBe(true);
    expect(rows.map((row) => row.cinemaId).sort()).toEqual(["c1", "c3"]);
  });
});
