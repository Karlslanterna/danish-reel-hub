import { describe, expect, it } from "vitest";
import { buildCityShellMovies, type CityShellScreeningRow } from "@/lib/city-catalog";
import type { Movie } from "@/lib/cinema-data";

const movie = (id: string, sourceIds: string[] = [id]): Movie => ({
  id,
  slug: id,
  title: id.toUpperCase(),
  runtime: 100,
  genre: [],
  year: 2026,
  director: "",
  rating: "",
  synopsis: "",
  poster: {},
  sourceIds,
});

const row = (
  movieId: string,
  startsAt: string,
  cinemaId = "cinema-1",
): CityShellScreeningRow => ({
  movie_id: movieId,
  cinema_id: cinemaId,
  starts_at: startsAt,
  local_date: startsAt.slice(0, 10),
});

describe("buildCityShellMovies", () => {
  it("ranks by sampled physical screenings and collapses source overlap", () => {
    const movies = [movie("a", ["a-source-1", "a-source-2"]), movie("b"), movie("c")];
    const rows = [
      row("a-source-1", "2026-08-22T10:00:00+00:00"),
      // Same public film, cinema and start from the second source: one physical screening.
      row("a-source-2", "2026-08-22T10:00:00+00:00"),
      row("a-source-1", "2026-08-22T12:00:00+00:00"),
      row("b", "2026-08-22T09:00:00+00:00"),
      row("b", "2026-08-22T11:00:00+00:00"),
      row("b", "2026-08-22T13:00:00+00:00"),
    ];

    const result = buildCityShellMovies(movies, rows);

    expect(result.candidateCount).toBe(2);
    expect(result.movies.map((item) => item.id)).toEqual(["b", "a"]);
    expect(result.movies.map((item) => item.screeningCount)).toEqual([3, 2]);
  });

  it("never emits more than the requested first-paint card count", () => {
    const movies = [movie("a"), movie("b"), movie("c")];
    const rows = [
      row("a", "2026-08-22T10:00:00+00:00"),
      row("b", "2026-08-22T11:00:00+00:00"),
      row("c", "2026-08-22T12:00:00+00:00"),
    ];

    const result = buildCityShellMovies(movies, rows, 2);

    expect(result.candidateCount).toBe(3);
    expect(result.movies).toHaveLength(2);
  });
});
