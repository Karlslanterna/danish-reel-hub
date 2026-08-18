import { describe, expect, it } from "vitest";
import type { Showtime } from "@/lib/cinema-data";
import { cinemaProgramShowtimesByMovie, groupCinemaShowtimesByDate } from "@/lib/cinema-program";

function showtime(overrides: Partial<Showtime> = {}): Showtime {
  return {
    movieId: "movie-1",
    cinemaId: "cinema-1",
    date: "2026-08-18",
    times: ["19:00"],
    hall: "Sal 1",
    bookingUrl: null,
    ticketUrls: [],
    formats: [],
    languages: [],
    events: [],
    ...overrides,
  };
}

describe("cinema programme filtering", () => {
  it("shows the complete programme when no date is selected", () => {
    const result = cinemaProgramShowtimesByMovie(
      [
        showtime(),
        showtime({ date: "2026-08-24", times: ["16:30"] }),
        showtime({ movieId: "movie-2", date: "2026-08-29" }),
      ],
      { date: null, format: null, language: null, event: null },
    );

    expect(result.get("movie-1")?.map((entry) => entry.date)).toEqual(["2026-08-18", "2026-08-24"]);
    expect(result.has("movie-2")).toBe(true);
  });

  it("restricts the programme after a date is selected", () => {
    const result = cinemaProgramShowtimesByMovie([showtime(), showtime({ date: "2026-08-24" })], {
      date: "2026-08-24",
      format: null,
      language: null,
      event: null,
    });

    expect(result.get("movie-1")?.map((entry) => entry.date)).toEqual(["2026-08-24"]);
  });

  it("applies presentation filters across the complete programme window", () => {
    const result = cinemaProgramShowtimesByMovie(
      [showtime({ formats: ["2D"] }), showtime({ date: "2026-08-24", formats: ["IMAX"] })],
      { date: null, format: "IMAX", language: null, event: null },
    );

    expect(result.get("movie-1")?.map((entry) => entry.date)).toEqual(["2026-08-24"]);
  });
});

describe("cinema programme date groups", () => {
  it("groups and orders screenings by date", () => {
    const result = groupCinemaShowtimesByDate([
      showtime({ date: "2026-08-24" }),
      showtime({ date: "2026-08-18", hall: "Sal 1" }),
      showtime({ date: "2026-08-18", hall: "Sal 2" }),
    ]);

    expect(result.map((group) => [group.date, group.showtimes.length])).toEqual([
      ["2026-08-18", 2],
      ["2026-08-24", 1],
    ]);
  });
});
