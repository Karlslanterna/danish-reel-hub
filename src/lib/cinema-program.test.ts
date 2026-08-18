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

  it("orders all visible time buttons globally across halls", () => {
    const result = groupCinemaShowtimesByDate([
      showtime({ hall: "Sal 1", times: ["12:30", "15:30", "21:30"] }),
      showtime({ hall: "Sal 2", times: ["17:00", "20:00"] }),
    ]);

    expect(result[0]?.slots.map((slot) => slot.time)).toEqual([
      "12:30",
      "15:30",
      "17:00",
      "20:00",
      "21:30",
    ]);
  });

  it("shows one useful button when duplicate sources advertise the same physical time", () => {
    const result = groupCinemaShowtimesByDate([
      showtime({ hall: "Kultunaut", times: ["16:00"], ticketUrls: [""] }),
      showtime({
        hall: "Sal 1",
        times: ["16:00"],
        bookingUrl: "https://tickets.example/16",
        ticketUrls: ["https://tickets.example/16"],
      }),
    ]);

    expect(result[0]?.slots).toEqual([
      { time: "16:00", url: "https://tickets.example/16", hall: "Sal 1" },
    ]);
  });
});
