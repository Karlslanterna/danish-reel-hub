import { describe, expect, it } from "vitest";
import {
  isPublicMovieTitle,
  normalizePublicGenres,
  publicMovieDisplayTitle,
  resolvePublicMovieYear,
  suppressCollidingSourcePosters,
} from "./public-movie";

describe("public movie catalog rules", () => {
  it("hides obvious event shells and operational placeholders", () => {
    for (const title of [
      "Særvisning",
      "Børnebiffen - Fra 3 år",
      "Børnebiffen september 2026 - 5-7 år",
      "SommerBørneBiffen 3-4 år",
      "SeniorBio - Ældresagen",
      "Bestil bord og mad",
      "Ferielukket/Lukket i dag - Biografkompagniet",
      "Film titel ikke valgt endnu",
      "Opera: Tosca fra Teatro dell Opera - Roma",
      "Foredrag og debat: Mens vi ser den anden vej...",
      "Koncert: Uklare Meldinger",
      "OFF: Hovedkonkurrence",
    ]) {
      expect(isPublicMovieTitle(title), title).toBe(false);
    }
  });

  it("keeps real films even when their title contains programme/event suffixes", () => {
    for (const title of [
      "The Witch - Event - Fright Night",
      "Pigen Holly - Strikkebio",
      "Marty Supreme - H.Bio - Timothée Chalamet",
      "MSIC 26-27: The Silence of Others",
      "Khartoum/Læger uden grænser",
    ]) {
      expect(isPublicMovieTitle(title), title).toBe(true);
    }
  });

  it("normalizes duplicate and non-genre source labels", () => {
    expect(
      normalizePublicGenres([
        "Andre Film",
        "Romance",
        "Romantik",
        "Horror",
        "Gyser",
        "Tegnefilm",
        "Animation",
        "Spændingsfilm",
        "Adventure",
        "Science Fiction",
      ]),
    ).toEqual(["Romantik", "Gyser", "Animation", "Thriller", "Eventyr", "Science fiction"]);
  });

  it("removes cinema programme suffixes without changing ordinary film titles", () => {
    expect(publicMovieDisplayTitle("The Witch - Event - Fright Night")).toBe("The Witch");
    expect(publicMovieDisplayTitle("Marty Supreme -H. Bio-Timothée Chalamet-CIN")).toBe(
      "Marty Supreme",
    );
    expect(publicMovieDisplayTitle("MSIC 26-27: The Silence of Others")).toBe(
      "The Silence of Others",
    );
    expect(publicMovieDisplayTitle("Aphaca - Brug for hinanden")).toBe(
      "Aphaca - Brug for hinanden",
    );
    expect(publicMovieDisplayTitle("Don't Look Back in Anger")).toBe("Don't Look Back in Anger");
  });

  it("does not present an eBillet booking-programme year as the film's release year", () => {
    expect(resolvePublicMovieYear({ id: "eb-movie-38603", year: 2026 })).toBe(0);
    expect(
      resolvePublicMovieYear({
        id: "eb-movie-38603",
        year: 2026,
        releaseDate: "1986-11-19",
      }),
    ).toBe(1986);
    expect(resolvePublicMovieYear({ id: "kn-7105634", year: 1986 })).toBe(1986);
  });

  it("suppresses one source poster reused by unrelated films", () => {
    const movies = suppressCollidingSourcePosters([
      {
        title: "The Witch - Late Night",
        tmdbId: null,
        posterSource: "source" as const,
        poster: { url: "https://poster.ebillet.dk/shared.hd.jpg" },
      },
      {
        title: "Børnebiffen",
        tmdbId: null,
        posterSource: "source" as const,
        poster: { url: "https://poster.ebillet.dk/shared.hd.jpg" },
      },
    ]);

    expect(movies.map((movie) => movie.poster.url)).toEqual([undefined, undefined]);
  });

  it("keeps TMDb artwork and same-film source artwork", () => {
    const shared = "https://image.tmdb.org/t/p/w500/poster.jpg";
    const tmdbMovies = suppressCollidingSourcePosters([
      { title: "Dobbeltfejl", tmdbId: 42, posterSource: "tmdb" as const, poster: { url: shared } },
      {
        title: "Dobbeltfejl – dansk tekst",
        tmdbId: 42,
        posterSource: "tmdb" as const,
        poster: { url: shared },
      },
    ]);
    const sourceMovies = suppressCollidingSourcePosters([
      { title: "Autofiktion", posterSource: "source" as const, poster: { url: "same.jpg" } },
      { title: "Autofiktion", posterSource: "source" as const, poster: { url: "same.jpg" } },
    ]);

    expect(tmdbMovies.every((movie) => movie.poster.url === shared)).toBe(true);
    expect(sourceMovies.every((movie) => movie.poster.url === "same.jpg")).toBe(true);
  });
});
