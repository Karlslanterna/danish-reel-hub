import { describe, expect, it } from "vitest";
import { pickMatch, searchQueries, sourceYearForMatch } from "./match";

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

  it("accepts one credible exact candidate without a year but rejects remakes", () => {
    const candidate = {
      id: 10,
      title: "Biler",
      original_title: "Cars",
      release_date: "2006-06-08",
      vote_count: 100,
      popularity: 4,
    };
    expect(pickMatch("Biler", null, [candidate])).toMatchObject({ matched: true, id: 10 });
    expect(
      pickMatch("Biler", null, [
        candidate,
        { ...candidate, id: 11, release_date: "2026-06-08" },
      ]),
    ).toMatchObject({ matched: false });
  });

  it("does not use eBillet's programme year unless the title states it", () => {
    expect(sourceYearForMatch({ id: "eb-movie-1", title: "Spirillen", year: 2026 })).toBeNull();
    expect(
      sourceYearForMatch({ id: "eb-movie-2", title: "Dobbeltspil (2018)", year: 2026 }),
    ).toBe(2018);
    expect(sourceYearForMatch({ id: "kn-1", title: "Autofiktion", year: 2026 })).toBe(2026);
  });

  it("strips language and programme variants before searching", () => {
    expect(searchQueries("Biler - Dansk Tale")[0]).toBe("Biler");
    expect(searchQueries("A Dessert for Constance - Sarah Maldoror")[0]).toBe(
      "A Dessert for Constance",
    );
  });
});
