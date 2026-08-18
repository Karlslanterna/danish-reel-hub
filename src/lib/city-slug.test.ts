import { describe, expect, it } from "vitest";
import { baseCityOf, citySlug } from "./city-slug";

describe("city normalization", () => {
  it("joins postcode districts with and without a trailing dot", () => {
    expect(baseCityOf("1609 København V")).toBe("København");
    expect(baseCityOf("1609 København V.")).toBe("København");
    expect(citySlug("1609 København V.")).toBe("koebenhavn");
  });

  it("keeps ordinary multi-word city names intact", () => {
    expect(baseCityOf("4771 Kalvehave")).toBe("Kalvehave");
    expect(baseCityOf("Nykøbing Falster")).toBe("Nykøbing Falster");
    expect(baseCityOf("4800 Nykøbing F")).toBe("Nykøbing F");
    expect(baseCityOf("7900 Nykøbing M")).toBe("Nykøbing M");
    expect(baseCityOf("7470 Karup J")).toBe("Karup J");
  });
});
