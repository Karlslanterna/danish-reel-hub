import { describe, expect, it } from "vitest";
import { chooseContinuityCandidate } from "./movie-continuity";

const anchor = {
  id: "canonical-odyssey",
  title: "The Odyssey (2026)",
  originalTitle: "The Odyssey",
  genres: ["Action", "Drama"],
  runtime: 170,
  year: 2026,
  tmdbId: null,
  ebilletBaseId: 458,
  ebilletMovieIds: [36773, 38279],
};

describe("Kultunaut movie continuity", () => {
  it("maps an unknown-year source id to one unique active strong title+genre anchor", () => {
    expect(
      chooseContinuityCandidate({
        incomingTitle: "The Odyssey",
        incomingYear: 0,
        incomingGenres: ["Action", "Drama"],
        incomingRuntime: 0,
        currentCanonicalId: "duplicate",
        candidates: [anchor, { id: "duplicate", title: "The Odyssey", genres: ["Action", "Drama"], year: 0 }],
      }),
    ).toEqual({ canonicalId: anchor.id });
  });

  it("never merges an unknown-year row from title alone", () => {
    expect(
      chooseContinuityCandidate({
        incomingTitle: "The Odyssey",
        incomingYear: 0,
        incomingGenres: [],
        currentCanonicalId: "duplicate",
        candidates: [anchor],
      }),
    ).toBeNull();
  });

  it("does not use another weak Kultunaut duplicate as an anchor", () => {
    expect(
      chooseContinuityCandidate({
        incomingTitle: "The Odyssey",
        incomingYear: 0,
        incomingGenres: ["Action", "Drama"],
        currentCanonicalId: "duplicate-a",
        candidates: [
          { id: "duplicate-b", title: "The Odyssey", genres: ["Action", "Drama"], year: 0 },
        ],
      }),
    ).toBeNull();
  });

  it("refuses an ambiguous pair of strong active candidates", () => {
    expect(
      chooseContinuityCandidate({
        incomingTitle: "The Odyssey",
        incomingYear: 0,
        incomingGenres: ["Action", "Drama"],
        candidates: [anchor, { ...anchor, id: "another-odyssey", year: 2027 }],
      }),
    ).toBeNull();
  });

  it("refuses a strong anchor with a different known year", () => {
    expect(
      chooseContinuityCandidate({
        incomingTitle: "The Odyssey",
        incomingYear: 2027,
        incomingGenres: ["Action", "Drama"],
        candidates: [anchor],
      }),
    ).toBeNull();
  });

  it("refuses incompatible runtime when both sources know it", () => {
    expect(
      chooseContinuityCandidate({
        incomingTitle: "The Odyssey",
        incomingYear: 2026,
        incomingGenres: ["Action", "Drama"],
        incomingRuntime: 90,
        candidates: [anchor],
      }),
    ).toBeNull();
  });
});
