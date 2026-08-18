import { describe, expect, it } from "vitest";
import {
  canonicalCinemaId,
  consolidatePublicCinemas,
  expandCinemaIds,
  remapScreeningCinemaIds,
} from "./cinema-catalog";

describe("public cinema catalog", () => {
  it("collapses known source rows onto the location-rich canonical cinema", () => {
    const result = consolidatePublicCinemas([
      { id: "eb-126", slug: "scala", name: "Scala" },
      { id: "kn-891098", slug: "scala-svendborg", name: "Scala Svendborg" },
      { id: "kn-other", slug: "other", name: "Other" },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: "kn-891098",
      slug: "scala-svendborg",
      name: "Scala Svendborg",
      sourceIds: ["eb-126", "kn-891098"],
      sourceSlugs: ["scala", "scala-svendborg"],
    });
  });

  it("expands either source id to both screening owners", () => {
    expect(new Set(expandCinemaIds(["kn-891098"]))).toEqual(new Set(["kn-891098", "eb-126"]));
    expect(new Set(expandCinemaIds(["eb-126"]))).toEqual(new Set(["kn-891098", "eb-126"]));
  });

  it("remaps screening rows without changing unknown cinemas", () => {
    expect(canonicalCinemaId("eb-126")).toBe("kn-891098");
    expect(
      remapScreeningCinemaIds([
        { cinema_id: "eb-126", movie_id: "m1" },
        { cinema_id: "kn-other", movie_id: "m2" },
      ]),
    ).toEqual([
      { cinema_id: "kn-891098", movie_id: "m1" },
      { cinema_id: "kn-other", movie_id: "m2" },
    ]);
  });

  it("does not rewrite an alias when its canonical row is absent", () => {
    expect(consolidatePublicCinemas([{ id: "eb-126", slug: "scala" }])[0]?.id).toBe("eb-126");
  });
});
