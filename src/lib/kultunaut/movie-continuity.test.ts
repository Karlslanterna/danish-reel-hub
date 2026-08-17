import { describe, expect, it } from "vitest";
import { chooseContinuityCandidate } from "./movie-continuity";

const anchor = {
  id: "canonical-odyssey",
  title: "The Odyssey (2026)",
  originalTitle: "The Odyssey",
  year: 2026,
  tmdbId: null,
  ebilletBaseId: 458,
  ebilletMovieIds: [36773, 38279],
};

describe("Kultunaut movie continuity", () => {
  it("rebinds a changed source id when repeated exact screenings point to one strong anchor", () => {
    expect(
      chooseContinuityCandidate({
        incomingTitle: "The Odyssey",
        incomingYear: 0,
        currentCanonicalId: "duplicate",
        totalSlots: 6,
        slotCandidates: [
          ["duplicate", anchor.id],
          ["duplicate", anchor.id],
          ["duplicate", anchor.id],
          ["duplicate"],
          ["duplicate"],
          ["duplicate"],
        ],
        candidates: [anchor, { id: "duplicate", title: "The Odyssey", year: 0 }],
      }),
    ).toMatchObject({ canonicalId: anchor.id, evidence: 3 });
  });

  it("never rebinds from one coincidental overlap", () => {
    expect(
      chooseContinuityCandidate({
        incomingTitle: "The Odyssey",
        incomingYear: 0,
        currentCanonicalId: "duplicate",
        totalSlots: 6,
        slotCandidates: [["duplicate", anchor.id]],
        candidates: [anchor],
      }),
    ).toBeNull();
  });

  it("does not merge two unknown-title-only Kultunaut rows without a strong anchor", () => {
    expect(
      chooseContinuityCandidate({
        incomingTitle: "The Odyssey",
        incomingYear: 0,
        currentCanonicalId: "duplicate-a",
        totalSlots: 6,
        slotCandidates: [
          ["duplicate-a", "duplicate-b"],
          ["duplicate-a", "duplicate-b"],
          ["duplicate-a", "duplicate-b"],
        ],
        candidates: [{ id: "duplicate-b", title: "The Odyssey", year: 0 }],
      }),
    ).toBeNull();
  });

  it("refuses a strong anchor with a different known year", () => {
    expect(
      chooseContinuityCandidate({
        incomingTitle: "The Odyssey",
        incomingYear: 2027,
        currentCanonicalId: "duplicate",
        totalSlots: 3,
        slotCandidates: [[anchor.id], [anchor.id], [anchor.id]],
        candidates: [anchor],
      }),
    ).toBeNull();
  });
});
