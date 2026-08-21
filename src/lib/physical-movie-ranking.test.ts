import { describe, expect, it } from "vitest";
import type { Movie, ShowtimeIndexRow } from "./cinema-data";
import { applyPhysicalScreeningStatsFromIndex } from "./physical-movie-ranking";

const movie = (id: string): Movie => ({
  id,
  slug: id,
  title: id,
  runtime: 100,
  genre: [],
  year: 2026,
  director: "",
  rating: "",
  synopsis: "",
  poster: {},
  screeningCount: 999,
});

const row = (
  movieId: string,
  cinemaId: string,
  date: string,
  times: string[],
  overrides: Partial<ShowtimeIndexRow> = {},
): ShowtimeIndexRow => ({
  movieId,
  cinemaId,
  date,
  times,
  formats: [],
  languages: [],
  events: [],
  ...overrides,
});

describe("physical movie screening stats", () => {
  it("counts one physical time once even when it appears in separate source/tag groups", () => {
    const [result] = applyPhysicalScreeningStatsFromIndex(
      [movie("film")],
      [
        row("film", "bio", "2026-08-22", ["18:00", "20:00"], { formats: ["2D"] }),
        row("film", "bio", "2026-08-22", ["18:00"], { languages: ["Dansk tale"] }),
      ],
    );

    expect(result?.screeningCount).toBe(2);
    expect(result?.nextScreeningDate).toBe("2026-08-22");
  });

  it("keeps different cinemas and start times as separate physical screenings", () => {
    const [result] = applyPhysicalScreeningStatsFromIndex(
      [movie("film")],
      [
        row("film", "bio-a", "2026-08-23", ["18:00", "20:00"]),
        row("film", "bio-b", "2026-08-23", ["18:00"]),
        row("film", "bio-a", "2026-08-22", ["21:00"]),
      ],
    );

    expect(result?.screeningCount).toBe(4);
    expect(result?.nextScreeningDate).toBe("2026-08-22");
  });

  it("resets stale raw-source counts when a movie has no physical rows", () => {
    const [result] = applyPhysicalScreeningStatsFromIndex([movie("film")], []);
    expect(result?.screeningCount).toBe(0);
    expect(result?.nextScreeningDate).toBeNull();
  });
});
