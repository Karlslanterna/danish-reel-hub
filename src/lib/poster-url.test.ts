import { describe, expect, it } from "vitest";
import {
  cardPosterSources,
  detailBackdropSources,
  isPlaceholderPosterUrl,
  toHttpsUrl,
} from "./poster-url";

describe("poster URLs", () => {
  it("upgrades plain HTTP and protocol-relative URLs", () => {
    expect(toHttpsUrl("http://example.com/poster.jpg")).toBe("https://example.com/poster.jpg");
    expect(toHttpsUrl("//example.com/poster.jpg")).toBe("https://example.com/poster.jpg");
  });

  it("serves compact responsive TMDb sources for listing cards", () => {
    const sources = cardPosterSources(
      "https://image.tmdb.org/t/p/w500/blfhMP7g9M54gujSbd4EC8VOIxU.jpg",
    );
    expect(sources.src).toBe(
      "https://image.tmdb.org/t/p/w342/blfhMP7g9M54gujSbd4EC8VOIxU.jpg",
    );
    expect(sources.srcSet).toContain("/w185/");
    expect(sources.srcSet).toContain("/w342/");
    expect(sources.srcSet).not.toContain("/w500/");
  });

  it("caps decorative TMDb detail backdrops below the stored w1280 asset", () => {
    const sources = detailBackdropSources(
      "https://image.tmdb.org/t/p/w1280/blfhMP7g9M54gujSbd4EC8VOIxU.jpg",
    );
    expect(sources.src).toBe(
      "https://image.tmdb.org/t/p/w780/blfhMP7g9M54gujSbd4EC8VOIxU.jpg",
    );
    expect(sources.srcSet).toContain("/w500/");
    expect(sources.srcSet).toContain("/w780/");
    expect(sources.srcSet).not.toContain("/w1280/");
  });

  it("leaves non-TMDb poster URLs untouched", () => {
    expect(cardPosterSources("https://www.kultunaut.dk/images/film/1/plakat.jpg")).toEqual({
      src: "https://www.kultunaut.dk/images/film/1/plakat.jpg",
    });
    expect(detailBackdropSources("https://example.com/backdrop.jpg")).toEqual({
      src: "https://example.com/backdrop.jpg",
    });
  });

  it("rejects known eBillet placeholder paths without rejecting real posters", () => {
    expect(isPlaceholderPosterUrl("https://admin.ebillet.dk/teamposters/")).toBe(true);
    expect(isPlaceholderPosterUrl("https://poster.ebillet.dk/plakat.hd.jpg")).toBe(true);
    expect(isPlaceholderPosterUrl("https://poster.ebillet.dk/DOBBELTFEJL-2026.hd.jpg")).toBe(false);
  });
});
