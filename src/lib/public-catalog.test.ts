import { describe, expect, it } from "vitest";
import type { Movie, Showtime } from "./cinema-data";
import {
  consolidatePublicMovies,
  compactShowtimes,
  compactShowtimeIndex,
  expandShowtimes,
  expandShowtimeIndex,
  remapShowtimeIndexToMovies,
  remapShowtimesToMovies,
} from "./public-catalog";

const movie = (value: Partial<Movie> & Pick<Movie, "id" | "slug" | "title">): Movie => ({
  runtime: 0,
  genre: [],
  year: 0,
  director: "",
  rating: "",
  synopsis: "",
  poster: {},
  screeningCount: 0,
  ...value,
});

describe("public catalog consolidation", () => {
  it("merges same-title records with compatible years and sums their screenings", () => {
    const result = consolidatePublicMovies([
      movie({
        id: "kn",
        slug: "autofiktion-kn",
        title: "Autofiktion",
        year: 2026,
        screeningCount: 10,
      }),
      movie({
        id: "eb",
        slug: "autofiktion-eb",
        title: "Autofiktion",
        year: 2026,
        tmdbId: 1088548,
        synopsis: "En rigtig beskrivelse",
        screeningCount: 47,
      }),
    ]);

    expect(result.movies).toHaveLength(1);
    expect(result.movies[0]).toMatchObject({
      id: "eb",
      slug: "autofiktion-eb",
      screeningCount: 57,
      sourceIds: ["eb", "kn"],
    });
    expect(result.movieIdMap.get("kn")).toBe("eb");
  });

  it("keeps distant remakes with the same title separate", () => {
    const result = consolidatePublicMovies([
      movie({ id: "old", slug: "gummi-tarzan-1981", title: "Gummi Tarzan", year: 1981 }),
      movie({ id: "new", slug: "gummi-tarzan-2022", title: "Gummi Tarzan", year: 2022 }),
    ]);
    expect(result.movies).toHaveLength(2);
  });

  it("does not let an unknown-year row bridge two distant remakes", () => {
    const result = consolidatePublicMovies([
      movie({ id: "old", slug: "the-thing-1951", title: "The Thing", year: 1951 }),
      movie({ id: "unknown", slug: "the-thing", title: "The Thing", year: 0 }),
      movie({ id: "new", slug: "the-thing-1982", title: "The Thing", year: 1982 }),
    ]);
    expect(result.movies).toHaveLength(3);
  });

  it("merges a trailing-year source title with its unknown-year duplicate", () => {
    const result = consolidatePublicMovies([
      movie({
        id: "canonical",
        slug: "the-odyssey-2026",
        title: "The Odyssey (2026)",
        year: 2026,
        poster: { url: "poster.jpg" },
      }),
      movie({ id: "variant", slug: "the-odyssey", title: "The Odyssey", year: 0 }),
    ]);

    expect(result.movies).toHaveLength(1);
    expect(result.movies[0]?.sourceIds).toEqual(expect.arrayContaining(["canonical", "variant"]));
    expect(result.movies[0]?.poster.url).toBe("poster.jpg");
  });

  it("merges connector and compound-spacing variants with compatible years", () => {
    const result = consolidatePublicMovies([
      movie({
        id: "vishwanath-a",
        slug: "vishwanath-and-sons",
        title: "Vishwanath and Sons",
        year: 2026,
      }),
      movie({
        id: "vishwanath-b",
        slug: "vishwanath-sons",
        title: "Vishwanath & Sons",
      }),
      movie({ id: "olsen-a", slug: "olsenbanden", title: "Olsenbanden Ser Rødt", year: 1976 }),
      movie({ id: "olsen-b", slug: "olsen-banden", title: "Olsen Banden Ser Rødt" }),
    ]);

    expect(result.movies).toHaveLength(2);
    expect(result.movies.map((item) => item.sourceIds.sort())).toEqual(
      expect.arrayContaining([
        ["vishwanath-a", "vishwanath-b"],
        ["olsen-a", "olsen-b"],
      ]),
    );
  });

  it("uses a matching synopsis to place an unknown-year row among active remakes", () => {
    const currentSynopsis =
      "Clara lever et tilsyneladende perfekt liv med en succesfuld karriere og sin charmerende kæreste Tobias.";
    const result = consolidatePublicMovies([
      movie({
        id: "current",
        slug: "dobbeltspil-2026",
        title: "Dobbeltspil (2026)",
        year: 2026,
        synopsis: `${currentSynopsis} Men facaden begynder at krakelere.`,
      }),
      movie({
        id: "unknown",
        slug: "dobbeltspil",
        title: "Dobbeltspil",
        synopsis: currentSynopsis,
      }),
      movie({
        id: "old",
        slug: "dobbeltspil-2018",
        title: "Dobbeltspil (2018)",
        year: 2018,
        synopsis: "En helt anden film med andre personer og en anden historie.",
      }),
    ]);

    expect(result.movies).toHaveLength(2);
    const current = result.movies.find((item) => item.sourceIds.includes("current"));
    expect(current?.sourceIds).toEqual(expect.arrayContaining(["current", "unknown"]));
    expect(result.movies.find((item) => item.id === "old")?.sourceIds).toEqual(["old"]);
  });

  it("uses a shared TMDb id as stronger identity than localized titles", () => {
    const result = consolidatePublicMovies([
      movie({
        id: "da",
        slug: "paw-patrol-dino-filmen",
        title: "Paw Patrol: Dino Filmen",
        tmdbId: 1185806,
      }),
      movie({
        id: "en",
        slug: "paw-patrol-the-dino-movie",
        title: "PAW Patrol: The Dino Movie",
        tmdbId: 1185806,
      }),
    ]);
    expect(result.movies).toHaveLength(1);
    expect(result.movies[0]?.sourceIds).toEqual(expect.arrayContaining(["da", "en"]));
  });

  it("remaps duplicate-source showtimes and keeps one best ticket per physical time", () => {
    const [canonical] = consolidatePublicMovies([
      movie({ id: "eb", slug: "film-eb", title: "Film", tmdbId: 7 }),
      movie({ id: "kn", slug: "film-kn", title: "Film", year: 2026 }),
    ]).movies;
    const base: Showtime = {
      movieId: "kn",
      cinemaId: "c1",
      date: "2026-08-20",
      times: ["20:00"],
      hall: "Sal 1",
      bookingUrl: null,
      ticketUrls: [""],
      formats: ["2D"],
      languages: [],
      events: [],
    };
    const remapped = remapShowtimesToMovies(
      [
        base,
        {
          ...base,
          movieId: "eb",
          bookingUrl: "https://tickets/20",
          ticketUrls: ["https://tickets/20"],
          languages: ["Danske undertekster"],
        },
      ],
      [canonical!],
    );

    expect(remapped).toHaveLength(1);
    expect(remapped[0]).toMatchObject({
      movieId: canonical!.id,
      times: ["20:00"],
      ticketUrls: ["https://tickets/20"],
      languages: ["Danske undertekster"],
    });
  });

  it("remaps and unions homepage-index tags", () => {
    const [canonical] = consolidatePublicMovies([
      movie({ id: "a", slug: "film-a", title: "Film", year: 2026 }),
      movie({ id: "b", slug: "film-b", title: "Film", year: 2026 }),
    ]).movies;
    const rows = remapShowtimeIndexToMovies(
      [
        {
          movieId: "a",
          cinemaId: "c",
          date: "2026-08-20",
          formats: ["2D"],
          languages: [],
          events: [],
        },
        {
          movieId: "b",
          cinemaId: "c",
          date: "2026-08-20",
          formats: [],
          languages: ["Dansk tale"],
          events: [],
        },
      ],
      [canonical!],
    );
    expect(rows).toEqual([
      {
        movieId: canonical!.id,
        cinemaId: "c",
        date: "2026-08-20",
        formats: ["2D"],
        languages: ["Dansk tale"],
        events: [],
      },
    ]);
  });

  it("round-trips the compact national showtime index", () => {
    const rows = [
      {
        movieId: "movie-a",
        cinemaId: "cinema-a",
        date: "2026-08-20",
        formats: ["2D"],
        languages: ["Dansk tale"],
        events: [],
      },
      {
        movieId: "movie-a",
        cinemaId: "cinema-b",
        date: "2026-08-21",
        formats: ["2D", "Atmos"],
        languages: [],
        events: ["Filmklub"],
      },
    ];
    expect(expandShowtimeIndex(compactShowtimeIndex(rows))).toEqual(rows);
  });

  it("round-trips compact film-page showtimes without losing ticket alignment", () => {
    const rows: Showtime[] = [
      {
        movieId: "movie-a",
        cinemaId: "cinema-a",
        date: "2026-08-20",
        times: ["18:00", "20:30"],
        hall: "Sal 1",
        bookingUrl: "https://tickets/18",
        ticketUrls: ["https://tickets/18", ""],
        formats: ["2D"],
        languages: ["Dansk tale"],
        events: [],
      },
    ];
    expect(expandShowtimes(compactShowtimes(rows))).toEqual(rows);
  });
});
