import { describe, expect, it } from "vitest";
import {
  BORNEBIFFEN_POSTER_URL,
  isPublicMovieTitle,
  normalizePublicGenres,
  preparePublicMoviePosters,
  publicMovieDisplayTitle,
  publicMovieIdentityTitle,
  resolvePublicMovieYear,
  suppressCollidingSourcePosters,
} from "./public-movie";

describe("public movie catalog rules", () => {
  it("hides obvious event shells and operational placeholders", () => {
    for (const title of [
      "Særvisning",
      "SeniorBio - Ældresagen",
      "Bestil bord og mad",
      "Ferielukket/Lukket i dag - Biografkompagniet",
      "Film titel ikke valgt endnu",
      "Opera: Tosca fra Teatro dell Opera - Roma",
      "Foredrag og debat: Mens vi ser den anden vej...",
      "Koncert: Uklare Meldinger",
      "OFF: Hovedkonkurrence",
      "OFF 2026 (Blok 1) - Events JUN-SEP",
      "Hadsten Bio Filmklub - 0. 2.klasse Hold 1",
      "Doktrin: Afgangspremiere årgang 1 Visning 1",
      "Harry Potter 25års Jubilæum - De fire første film",
    ]) {
      expect(isPublicMovieTitle(title), title).toBe(false);
    }
  });

  it("keeps bookable Børnebiffen film packages public", () => {
    for (const title of [
      "Børnebiffen - Fra 3 år",
      "Børnebiffen august 2026 - 5-7 år (Havet)",
      "SommerBørneBiffen 3-4 år",
    ]) {
      expect(isPublicMovieTitle(title), title).toBe(true);
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
    expect(publicMovieDisplayTitle("Biler - Dansk Tale")).toBe("Biler");
    expect(publicMovieDisplayTitle("Vaiana - Med dansk tale")).toBe("Vaiana");
    expect(publicMovieDisplayTitle("Veronikas to liv - Cin. Præs.")).toBe("Veronikas to liv");
    expect(publicMovieDisplayTitle("A Dessert for Constance - Sarah Maldoror")).toBe(
      "A Dessert for Constance",
    );
    expect(publicMovieDisplayTitle("1776 - Viva la Revolución")).toBe("1776");
    expect(publicMovieDisplayTitle("The End of Oak Street - (2/9 sidste dag)")).toBe(
      "The End of Oak Street",
    );
    expect(publicMovieDisplayTitle("Nøjsomheden (Vises m. Dk. tekster)")).toBe("Nøjsomheden");
  });

  it("uses release-year and connector variants only for identity, not display", () => {
    expect(publicMovieDisplayTitle("The Odyssey (2026)")).toBe("The Odyssey (2026)");
    expect(publicMovieIdentityTitle("The Odyssey (2026)")).toBe("the odyssey");
    expect(publicMovieIdentityTitle("Vishwanath & Sons")).toBe(
      publicMovieIdentityTitle("Vishwanath and Sons"),
    );
  });

  it("does not present an eBillet booking-programme year as the film's release year", () => {
    expect(resolvePublicMovieYear({ id: "eb-movie-38603", year: 2026 })).toBe(0);
    expect(
      resolvePublicMovieYear({
        id: "eb-movie-16329",
        title: "Dobbeltspil (2018)",
        year: 2026,
      }),
    ).toBe(2018);
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

  it("uses the local Børnebiffen poster after rejecting shared source artwork", () => {
    const movies = preparePublicMoviePosters([
      {
        title: "The Witch - Late Night",
        posterSource: "source" as const,
        poster: { url: "https://poster.ebillet.dk/shared.hd.jpg" },
      },
      {
        title: "Børnebiffen august 2026 - 3-5 år (Havet)",
        posterSource: "source" as const,
        poster: { url: "https://poster.ebillet.dk/shared.hd.jpg" },
      },
    ]);

    expect(movies[0]?.poster.url).toBeUndefined();
    expect(movies[1]?.poster).toMatchObject({
      url: BORNEBIFFEN_POSTER_URL,
      alt: "Cinemateket – Det Danske Filminstitut",
      fit: "contain",
    });
    expect(movies[1]?.posterSource).toBe("programme");
  });
});
