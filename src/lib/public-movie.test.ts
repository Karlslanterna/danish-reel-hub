import { describe, expect, it } from "vitest";
import { isPublicMovieTitle, normalizePublicGenres } from "./public-movie";

describe("public movie catalog rules", () => {
  it("hides obvious event shells and operational placeholders", () => {
    for (const title of [
      "Særvisning",
      "Børnebiffen - Fra 3 år",
      "Børnebiffen september 2026 - 5-7 år",
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
});
