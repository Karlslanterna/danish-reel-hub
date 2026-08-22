import { describe, expect, it } from "vitest";
import { collapseChildrenScreeningSignals } from "./children-screening-signals";

describe("children screening signals", () => {
  it("collapses repeated screening rows to the only evidence the classifier needs", () => {
    expect(
      collapseChildrenScreeningSignals([
        { movie_id: "movie-a", events: ["Børnebiffen"], languages: [] },
        { movie_id: "movie-a", events: ["Børnebiffen"], languages: ["Dansk tale"] },
        { movie_id: "movie-b", events: [], languages: ["Original version"] },
      ]),
    ).toEqual([
      { movieId: "movie-a", events: ["Børnebiffen"], languages: ["Dansk tale"] },
      { movieId: "movie-b", events: [], languages: ["Original version"] },
    ]);
  });
});
