import { describe, expect, it } from "vitest";
import {
  cardPosterSources,
  detailBackdropSources,
  isPlaceholderPosterUrl,
  listingPosterSources,
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

  it("uses eBillet's compact large poster with the stored HD asset as fallback", () => {
    expect(cardPosterSources("https://poster.ebillet.dk/100LITER-GULD-2026.hd.jpg")).toEqual({
      src: "https://poster.ebillet.dk/100LITER-GULD-2026.large.jpg",
      fallbackSrc: "https://poster.ebillet.dk/100LITER-GULD-2026.hd.jpg",
    });
  });

  it("does not rewrite an eBillet poster that is already compact", () => {
    expect(cardPosterSources("https://poster.ebillet.dk/100LITER-GULD-2026.large.jpg")).toEqual({
      src: "https://poster.ebillet.dk/100LITER-GULD-2026.large.jpg",
    });
  });

  it("omits raw Kultunaut posters on listings while retaining them for detail surfaces", () => {
    const poster = "https://www.kultunaut.dk/images/film/7106751/plakat.jpg";
    expect(listingPosterSources(poster)).toEqual({});
    expect(cardPosterSources(poster)).toEqual({ src: poster });
  });

  it("still optimizes known providers on listing surfaces", () => {
    expect(listingPosterSources("https://poster.ebillet.dk/100LITER-GULD-2026.hd.jpg")).toEqual({
      src: "https://poster.ebillet.dk/100LITER-GULD-2026.large.jpg",
      fallbackSrc: "https://poster.ebillet.dk/100LITER-GULD-2026.hd.jpg",
    });
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

  it("leaves other non-TMDb poster URLs untouched", () => {
    expect(cardPosterSources("https://example.com/poster.jpg")).toEqual({
      src: "https://example.com/poster.jpg",
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
