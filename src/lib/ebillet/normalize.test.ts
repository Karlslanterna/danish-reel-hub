import { describe, expect, it } from "vitest";
import type { EbilletMoviesResponse } from "./api.server";
import {
  buildMovieGroups,
  ebilletStartsAt,
  normalizeEbilletScreenings,
} from "./normalize";

const ORG = 108;
const NOW = new Date("2026-08-17T12:00:00.000Z");

const payload: EbilletMoviesResponse = {
  organizers: [{ id: ORG, name: "Grand Teatret" }],
  movieBases: [
    { id: 10, name: "Gyldig film" },
    { id: 20, name: "Umulig fremtidsfilm" },
  ],
  movies: [
    { id: 100, baseId: 10, name: "Gyldig film" },
    { id: 200, baseId: 20, name: "Umulig fremtidsfilm" },
  ],
  showtimes: [
    {
      id: 1,
      movieId: 100,
      movieBaseId: 10,
      locationId: 1,
      locationName: "Sal 1",
      organizerId: ORG,
      dateTime: "2026-08-20T20:00:00",
    },
    {
      id: 2,
      movieId: 200,
      movieBaseId: 20,
      locationId: 1,
      locationName: "Sal 1",
      organizerId: ORG,
      dateTime: "2029-03-14T09:30:00",
    },
  ],
  showtimeTypes: [],
};

describe("eBillet normalization", () => {
  it("interprets offset-less eBillet timestamps as Europe/Copenhagen wall clock", () => {
    expect(ebilletStartsAt("2026-08-20T20:00:00")).toBe("2026-08-20T18:00:00.000Z");
  });

  it("drops implausible future screenings before canonical promotion", () => {
    const screenings = normalizeEbilletScreenings(ORG, payload, NOW);
    expect(screenings).toHaveLength(1);
    expect(screenings[0]?.sourceRef).toBe("eb-108-1");
    expect(screenings[0]?.localDate).toBe("2026-08-20");
    expect(screenings[0]?.localTime).toBe("20:00");
  });

  it("does not create movie groups that are backed only by rejected screenings", () => {
    const groups = buildMovieGroups(payload, NOW);
    expect(groups.map((g) => g.ref)).toEqual(["base-10"]);
  });

  it("collapses multiple booking ids for one physical screening deterministically", () => {
    const duplicated: EbilletMoviesResponse = {
      ...payload,
      showtimes: [
        {
          id: 51,
          movieId: 100,
          movieBaseId: 10,
          locationId: 1,
          locationName: "Sal 1",
          organizerId: ORG,
          dateTime: "2026-08-20T20:00:00",
          freeSeats: 91,
          buyInfo: { enabled: true },
        },
        {
          id: 41,
          movieId: 100,
          movieBaseId: 10,
          locationId: 1,
          locationName: "Sal 1",
          organizerId: ORG,
          dateTime: "2026-08-20T20:00:00",
          freeSeats: 100,
          buyInfo: { enabled: true },
        },
      ],
    };

    const screenings = normalizeEbilletScreenings(ORG, duplicated, NOW);
    expect(screenings).toHaveLength(1);
    expect(screenings[0]?.sourceRef).toBe("eb-108-41");
    expect(screenings[0]?.freeSeats).toBe(100);
  });

  it("prefers a bookable duplicate over a lower disabled booking id", () => {
    const duplicated: EbilletMoviesResponse = {
      ...payload,
      showtimes: [
        {
          id: 40,
          movieId: 100,
          movieBaseId: 10,
          locationId: 1,
          locationName: "Sal 1",
          organizerId: ORG,
          dateTime: "2026-08-20T20:00:00",
          buyInfo: { enabled: false },
        },
        {
          id: 50,
          movieId: 100,
          movieBaseId: 10,
          locationId: 1,
          locationName: "Sal 1",
          organizerId: ORG,
          dateTime: "2026-08-20T20:00:00",
          buyInfo: { enabled: true },
        },
      ],
    };

    const screenings = normalizeEbilletScreenings(ORG, duplicated, NOW);
    expect(screenings).toHaveLength(1);
    expect(screenings[0]?.sourceRef).toBe("eb-108-50");
  });
});
