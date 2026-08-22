import { describe, expect, it } from "vitest";
import { representativeSchemaShowtimes } from "./movie-schema-programme";

describe("representative movie schema programme", () => {
  it("deduplicates source overlap by physical cinema and start time", () => {
    const rows = [
      {
        movie_id: "kn-film",
        cinema_id: "kn-28463",
        starts_at: "2026-08-22T18:00:00.000Z",
        local_date: "2026-08-22",
        local_time: "20:00:00",
        hall: "Sal 1",
        ticket_url: null,
      },
      {
        movie_id: "eb-film",
        cinema_id: "eb-168",
        starts_at: "2026-08-22T18:00:00.000Z",
        local_date: "2026-08-22",
        local_time: "20:00:00",
        hall: "",
        ticket_url: "https://flow.ebillet.dk/billetter/1/2?org=168",
      },
      {
        movie_id: "kn-film",
        cinema_id: "kn-28463",
        starts_at: "2026-08-22T20:00:00.000Z",
        local_date: "2026-08-22",
        local_time: "22:00:00",
        hall: "Sal 1",
        ticket_url: "https://example.com/late",
      },
    ];

    const result = representativeSchemaShowtimes(rows, 3);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      cinemaId: "kn-28463",
      date: "2026-08-22",
      times: ["20:00"],
      bookingUrl: "https://flow.ebillet.dk/billetter/1/2?org=168",
    });
    expect(result[1]?.times).toEqual(["22:00"]);
  });

  it("keeps only the requested number of earliest physical screenings", () => {
    const rows = Array.from({ length: 8 }, (_, index) => ({
      movie_id: "film",
      cinema_id: `cinema-${index}`,
      starts_at: `2026-08-2${index + 1}T18:00:00.000Z`,
      local_date: `2026-08-2${index + 1}`,
      local_time: "20:00:00",
      hall: "",
      ticket_url: null,
    })).reverse();

    const result = representativeSchemaShowtimes(rows, 3);
    expect(result).toHaveLength(3);
    expect(result.map((row) => row.date)).toEqual(["2026-08-21", "2026-08-22", "2026-08-23"]);
  });
});
