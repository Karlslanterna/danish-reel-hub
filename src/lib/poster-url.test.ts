import { describe, expect, it } from "vitest";
import { isPlaceholderPosterUrl, toHttpsUrl } from "./poster-url";

describe("poster URLs", () => {
  it("upgrades plain HTTP and protocol-relative URLs", () => {
    expect(toHttpsUrl("http://example.com/poster.jpg")).toBe("https://example.com/poster.jpg");
    expect(toHttpsUrl("//example.com/poster.jpg")).toBe("https://example.com/poster.jpg");
  });

  it("rejects known eBillet placeholder paths without rejecting real posters", () => {
    expect(isPlaceholderPosterUrl("https://admin.ebillet.dk/teamposters/")).toBe(true);
    expect(isPlaceholderPosterUrl("https://poster.ebillet.dk/plakat.hd.jpg")).toBe(true);
    expect(isPlaceholderPosterUrl("https://poster.ebillet.dk/DOBBELTFEJL-2026.hd.jpg")).toBe(false);
  });
});
