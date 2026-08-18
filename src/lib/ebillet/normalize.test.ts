import { describe, expect, it } from "vitest";
import type { EbilletMoviesResponse } from "./api.server";
import { buildMovieGroups, ebilletStartsAt, normalizeEbilletScreenings } from "./normalize";

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
    expect(screenings[0]?.ticketUrl).toBe("https://flow.ebillet.dk/billetter/100/1?org=108");
  });

  it("does not create movie groups that are backed only by rejected screenings", () => {
    const groups = buildMovieGroups(payload, NOW);
    expect(groups.map((g) => g.ref)).toEqual(["base-10"]);
  });

  it("does not persist one eBillet poster reused by unrelated movie bases", () => {
    const sharedPoster = "https://poster.ebillet.dk/shared.hd.jpg";
    const withCollision: EbilletMoviesResponse = {
      organizers: payload.organizers,
      movieBases: [
        { id: 40, name: "The Witch", posters: { hd: sharedPoster } },
        { id: 50, name: "Børnebiffen", posters: { hd: sharedPoster } },
      ],
      movies: [
        { id: 400, baseId: 40, name: "The Witch" },
        { id: 500, baseId: 50, name: "Børnebiffen" },
      ],
      showtimes: [
        {
          id: 70,
          movieId: 400,
          movieBaseId: 40,
          locationId: 1,
          organizerId: ORG,
          dateTime: "2026-08-20T20:00:00",
        },
        {
          id: 71,
          movieId: 500,
          movieBaseId: 50,
          locationId: 1,
          organizerId: ORG,
          dateTime: "2026-08-20T10:00:00",
        },
      ],
      showtimeTypes: [],
    };

    expect(buildMovieGroups(withCollision, NOW).map((group) => group.posterUrl)).toEqual([
      null,
      null,
    ]);
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

  it("derives Danish-language and event filters from eBillet presentation text", () => {
    const tagged: EbilletMoviesResponse = {
      organizers: payload.organizers,
      movieBases: [{ id: 30, name: "Vaiana" }],
      movies: [
        {
          id: 300,
          baseId: 30,
          name: "Vaiana - DK Tale",
          originalName: "Moana",
          dimension: "2",
        },
      ],
      showtimeTypes: [{ id: 4, name: "Seniorbio" }],
      showtimes: [
        {
          id: 60,
          movieId: 300,
          movieBaseId: 30,
          locationId: 1,
          locationName: "Sal 1",
          organizerId: ORG,
          type: 4,
          dateTime: "2026-08-20T15:00:00",
        },
      ],
    };

    const [screening] = normalizeEbilletScreenings(ORG, tagged, NOW);
    expect(screening?.formats).toEqual(["2D"]);
    expect(screening?.languages).toEqual(["Dansk tale"]);
    expect(screening?.events).toEqual(["Seniorbio"]);
  });

  it("normalizes eBillet subtitle and original-version labels", () => {
    const tagged: EbilletMoviesResponse = {
      organizers: payload.organizers,
      movieBases: [{ id: 31, name: "Example" }],
      movies: [
        {
          id: 301,
          baseId: 31,
          name: "Example - Org. tale - danske undertekster",
          dimension: "3",
        },
      ],
      showtimeTypes: [],
      showtimes: [
        {
          id: 61,
          movieId: 301,
          movieBaseId: 31,
          locationId: 1,
          locationName: "Sal 2",
          organizerId: ORG,
          dateTime: "2026-08-20T17:00:00",
        },
      ],
    };

    const [screening] = normalizeEbilletScreenings(ORG, tagged, NOW);
    expect(screening?.formats).toEqual(["3D"]);
    expect(screening?.languages).toEqual(["Danske undertekster", "Originalversion"]);
  });
});
