import { describe, expect, it } from "vitest";
import {
  groupScreeningIndexForUi,
  groupScreeningsForUi,
  normalizeTicketUrl,
} from "./screening-read-model";
import { compactMovieForListing, mapShowtimeIndexGroups, type Movie } from "./cinema-data";

describe("compactMovieForListing", () => {
  it("keeps card and canonical identity fields while dropping detail-only payload", () => {
    const movie: Movie = {
      id: "canonical",
      slug: "min-film",
      title: "Min film",
      runtime: 110,
      genre: ["Drama"],
      year: 2026,
      director: "Instruktør",
      rating: "11",
      synopsis: "En meget lang beskrivelse",
      poster: { url: "https://example.com/poster.jpg" },
      backdropUrl: "https://example.com/backdrop.jpg",
      trailerUrl: "https://example.com/trailer",
      cast: [{ name: "Skuespiller" }],
      sourceIds: ["source-a", "source-b"],
      sourceSlugs: ["min-film", "min-film-alias"],
    };

    expect(compactMovieForListing(movie)).toEqual({
      id: "canonical",
      slug: "min-film",
      title: "Min film",
      runtime: 110,
      genre: ["Drama"],
      year: 2026,
      director: "Instruktør",
      rating: "11",
      synopsis: "",
      poster: { url: "https://example.com/poster.jpg" },
      screeningCount: undefined,
      sourceIds: ["source-a", "source-b"],
      sourceSlugs: ["min-film", "min-film-alias"],
    });
  });
});

describe("mapShowtimeIndexGroups", () => {
  it("preserves exact tag groups from the aggregated database response", () => {
    expect(
      mapShowtimeIndexGroups([
        {
          movie_id: "m1",
          cinema_id: "c1",
          local_date: "2026-08-20",
          times: ["12:00", "14:30"],
          formats: ["2D"],
          languages: ["Dansk tale"],
          events: ["Babybio"],
        },
        {
          movie_id: "m1",
          cinema_id: "c1",
          local_date: "2026-08-20",
          times: ["19:00"],
          formats: ["2D"],
          languages: [],
          events: [],
        },
      ]),
    ).toEqual([
      {
        movieId: "m1",
        cinemaId: "c1",
        date: "2026-08-20",
        times: ["12:00", "14:30"],
        formats: ["2D"],
        languages: ["Dansk tale"],
        events: ["Babybio"],
      },
      {
        movieId: "m1",
        cinemaId: "c1",
        date: "2026-08-20",
        times: ["19:00"],
        formats: ["2D"],
        languages: [],
        events: [],
      },
    ]);
  });
});

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
        formats: ["2D"],
        languages: ["Dansk tekst"],
        events: [],
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
    expect(grouped[0].formats).toEqual(["2D"]);
    expect(grouped[0].languages).toContain("Dansk tekst");
    expect(grouped[0].events).toEqual([]);
  });

  it("repairs old Lanterna eBillet URLs without touching other ticket providers", () => {
    expect(
      normalizeTicketUrl("https://flow.ebillet.dk/booking/38141/415567?organizerIds=141"),
    ).toBe("https://flow.ebillet.dk/billetter/38141/415567?org=141");
    expect(normalizeTicketUrl("https://example.com/tickets/123")).toBe(
      "https://example.com/tickets/123",
    );
  });

  it("suppresses malformed, relative and unsafe ticket URLs", () => {
    expect(normalizeTicketUrl("&start=2026-08-20T18:00:00Z")).toBeNull();
    expect(normalizeTicketUrl("/relative-ticket-path")).toBeNull();
    expect(normalizeTicketUrl("javascript:alert(1)")).toBeNull();
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
  it("keeps different screening tags separate within the same movie/cinema/date", () => {
    const grouped = groupScreeningIndexForUi([
      {
        movie_id: "m1",
        cinema_id: "c1",
        local_date: "2026-08-20",
        local_time: "18:00:00",
        formats: ["2D"],
        languages: [],
        events: ["Premiere"],
      },
      {
        movie_id: "m1",
        cinema_id: "c1",
        local_date: "2026-08-20",
        local_time: "20:30:00",
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
        times: ["18:00"],
        formats: ["2D"],
        languages: [],
        events: ["Premiere"],
      },
      {
        movieId: "m1",
        cinemaId: "c1",
        date: "2026-08-20",
        times: ["20:30"],
        formats: ["Atmos"],
        languages: ["Dansk tekst"],
        events: [],
      },
    ]);
  });
});
