import { describe, expect, it } from "vitest";
import { applyCuratedProgrammeTags, programmeTagsForMovieTitle } from "./film-programmes";

describe("official film programme catalogues", () => {
  it("recognizes current titles and harmless title suffixes", () => {
    expect(programmeTagsForMovieTitle("The Invite")).toEqual(["Filmporten"]);
    expect(programmeTagsForMovieTitle("Nøjsomheden (2026)")).toEqual([
      "Biografklub Danmark",
    ]);
  });

  it("rejects expired and partner-preview titles", () => {
    expect(programmeTagsForMovieTitle("Affektionsværdi")).toEqual([]);
    expect(programmeTagsForMovieTitle("Pressure")).toEqual([]);
    expect(programmeTagsForMovieTitle("Hana Korea")).toEqual([]);
  });

  it("replaces untrusted programme words while preserving physical events", () => {
    expect(
      applyCuratedProgrammeTags(
        { formats: [], languages: [], events: ["Babybio", "Biografklub Danmark"] },
        "Pressure",
      ).events,
    ).toEqual(["Babybio"]);
    expect(
      applyCuratedProgrammeTags({ formats: [], languages: [], events: [] }, "Dobbeltfejl")
        .events,
    ).toEqual(["Biografklub Danmark"]);
  });
});
