import { describe, expect, it } from "vitest";
import { pickMatch, searchQueries } from "./match";

describe("TMDb matching", () => {
  it("searches a clean film title before source programme labels", () => {
    expect(searchQueries("The Witch - Event - Fright Night").slice(0, 2)).toEqual([
      "The Witch",
      "The Witch - Event - Fright Night",
    ]);
  });

  it("requires an exact normalized title and compatible year", () => {
    expect(
      pickMatch("Autofiktion", 2026, [
        {
          id: 10,
          title: "Autofiktion",
          original_title: "Autofiction",
          release_date: "2026-03-01",
          vote_count: 20,
          popularity: 2,
        },
      ]),
    ).toMatchObject({ matched: true, id: 10 });
    expect(
      pickMatch("Autofiktion", 2026, [
        {
          id: 11,
          title: "Autofiktion",
          original_title: "Autofiction",
          release_date: "1998-03-01",
          vote_count: 20,
          popularity: 2,
        },
      ]),
    ).toMatchObject({ matched: false });
  });
});
