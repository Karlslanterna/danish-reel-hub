import { describe, expect, it } from "vitest";
import type { Cinema, Movie, Showtime } from "./cinema-data";
import { homeSchemas, movieSchemas } from "./jsonld";

describe("homeSchemas", () => {
  it("does not advertise a URL search action the homepage does not implement", () => {
    const website = JSON.parse(homeSchemas()[0]!.children) as Record<string, unknown>;
    expect(website.potentialAction).toBeUndefined();
  });
});

describe("movieSchemas", () => {
  it("keeps structured screening data representative and bounded", () => {
    const movie: Movie = {
      id: "movie",
      slug: "movie",
      title: "Movie",
      runtime: 100,
      genre: ["Drama"],
      year: 2026,
      director: "",
      rating: "",
      synopsis: "",
      poster: {},
    };
    const cinema: Cinema = {
      id: "cinema",
      slug: "cinema",
      name: "Cinema",
      city: "København",
      address: "",
      description: "",
      screens: 1,
      latitude: null,
      longitude: null,
      website: null,
    };
    const showtimes: Showtime[] = Array.from({ length: 120 }, (_, index) => ({
      movieId: movie.id,
      cinemaId: cinema.id,
      date: "2026-08-20",
      times: [`${String(Math.floor(index / 6) % 24).padStart(2, "0")}:00`],
      hall: `Sal ${index}`,
      bookingUrl: null,
      ticketUrls: [""],
      formats: [],
      languages: [],
      events: [],
    }));

    const schemas = movieSchemas(movie, [cinema], showtimes);
    const graph = JSON.parse(schemas[1]!.children) as { "@graph": unknown[] };

    expect(schemas).toHaveLength(3);
    expect(graph["@graph"]).toHaveLength(100);
  });

  it("uses the local canonical URL and complete city breadcrumb when supplied", () => {
    const movie: Movie = {
      id: "movie",
      slug: "movie",
      title: "Movie",
      runtime: 100,
      genre: ["Drama"],
      year: 2026,
      director: "",
      rating: "",
      synopsis: "",
      poster: {},
    };
    const schemas = movieSchemas(movie, [], [], {
      path: "/koebenhavn/film/movie",
      breadcrumbs: [
        { name: "Forside", url: "https://lanterna.dk/" },
        { name: "København", url: "https://lanterna.dk/koebenhavn" },
        { name: "Movie i København", url: "https://lanterna.dk/koebenhavn/film/movie" },
      ],
    });
    const entity = JSON.parse(schemas[0]!.children) as { url: string };
    const breadcrumbs = JSON.parse(schemas.at(-1)!.children) as {
      itemListElement: Array<{ item: string }>;
    };

    expect(entity.url).toBe("https://lanterna.dk/koebenhavn/film/movie");
    expect(breadcrumbs.itemListElement.map((item) => item.item)).toEqual([
      "https://lanterna.dk/",
      "https://lanterna.dk/koebenhavn",
      "https://lanterna.dk/koebenhavn/film/movie",
    ]);
  });
});
