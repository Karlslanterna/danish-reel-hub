import { describe, expect, it } from "vitest";
import {
  groupScreeningIndexForUi,
  groupScreeningsForUi,
  normalizeTicketUrl,
} from "./screening-read-model";

describe("groupScreeningsForUi", () => {
  it("preserves one ticket URL per exact screening while keeping the existing UI shape", () => {
    const grouped = groupScreeningsForUi([
      {
        movie_id: "m1",
        cinema_id: "c1",
        starts_at: "2026-08-20T18:30:00.000Z",
        local_date: "2026-08-20",
        local_time: "20:30:00",
        hall: "Sal 1",
        ticket_url: "https://tickets/late",
        formats: ["2D"],
        languages: ["Dansk tekst"],
        events: [],
      },
      {
        movie_id: "m1",
        cinema_id: "c1",
        starts_at: "2026-08-20T16:00:00.000Z",
        local_date: "2026-08-20",
        local_time: "18:00:00",
        hall: "Sal 1",
        ticket_url: "https://tickets/early",
        formats: ["2D", "Atmos"],
        languages: [],
        events: ["Premiere"],
      },
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({
      movieId: "m1",
      cinemaId: "c1",
      date: "2026-08-20",
      hall: "Sal 1",
      times: ["18:00", "20:30"],
      ticketUrls: ["https://tickets/early", "https://tickets/late"],
      bookingUrl: "https://tickets/early",
    });
    expect(grouped[0].formats).toEqual(expect.arrayContaining(["2D", "Atmos"]));
    expect(grouped[0].languages).toContain("Dansk tekst");
    expect(grouped[0].events).toContain("Premiere");
  });

  it("repairs old Lanterna eBillet URLs without touching other ticket providers", () => {
    expect(
      normalizeTicketUrl("https://flow.ebillet.dk/booking/38141/415567?organizerIds=141"),
    ).toBe("https://flow.ebillet.dk/billetter/38141/415567?org=141");
    expect(normalizeTicketUrl("https://example.com/tickets/123")).toBe(
      "https://example.com/tickets/123",
    );
  });

  it("keeps halls separate", () => {
    const base = {
      movie_id: "m1",
      cinema_id: "c1",
      starts_at: "2026-08-20T16:00:00.000Z",
      local_date: "2026-08-20",
      local_time: "18:00:00",
      ticket_url: null,
      formats: [],
      languages: [],
      events: [],
    };
    const grouped = groupScreeningsForUi([
      { ...base, hall: "Sal 1" },
      { ...base, hall: "Sal 2", starts_at: "2026-08-20T17:00:00.000Z", local_time: "19:00:00" },
    ]);
    expect(grouped).toHaveLength(2);
  });
});

describe("groupScreeningIndexForUi", () => {
  it("collapses physical screenings to one movie/cinema/date row and unions tags", () => {
    const grouped = groupScreeningIndexForUi([
      {
        movie_id: "m1",
        cinema_id: "c1",
        local_date: "2026-08-20",
        formats: ["2D"],
        languages: [],
        events: ["Premiere"],
      },
      {
        movie_id: "m1",
        cinema_id: "c1",
        local_date: "2026-08-20",
        formats: ["Atmos"],
        languages: ["Dansk tekst"],
        events: [],
      },
    ]);

    expect(grouped).toEqual([
      {
        movieId: "m1",
        cinemaId: "c1",
        date: "2026-08-20",
        formats: ["2D", "Atmos"],
        languages: ["Dansk tekst"],
        events: ["Premiere"],
      },
    ]);
  });
});
