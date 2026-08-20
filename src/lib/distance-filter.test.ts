import { describe, expect, it } from "vitest";
import { haversineKm } from "@/lib/filters";

describe("distance filter geometry", () => {
  const copenhagen = { lat: 55.6761, lng: 12.5683 };

  it("returns zero for the same location", () => {
    expect(haversineKm(copenhagen, copenhagen)).toBe(0);
  });

  it("keeps nearby Copenhagen points inside the expected radius bands", () => {
    const frederiksberg = { lat: 55.6794, lng: 12.5346 };
    const lyngby = { lat: 55.7704, lng: 12.5038 };

    const frederiksbergKm = haversineKm(copenhagen, frederiksberg);
    const lyngbyKm = haversineKm(copenhagen, lyngby);

    expect(frederiksbergKm).toBeGreaterThan(2);
    expect(frederiksbergKm).toBeLessThan(5);
    expect(lyngbyKm).toBeGreaterThan(10);
    expect(lyngbyKm).toBeLessThan(25);
  });
});
