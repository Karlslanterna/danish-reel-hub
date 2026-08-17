import { describe, expect, it } from "vitest";
import { matchCinema, type MatchCinema } from "./cinema-match";

const cinema = (over: Partial<MatchCinema> = {}): MatchCinema => ({
  id: "c1",
  name: "Kosmorama",
  slug: "kosmorama",
  city: "6100 Haderslev",
  ebillet_organizer_id: null,
  ...over,
});

describe("matchCinema", () => {
  it("reuses the cinema already claimed by the same organizer", () => {
    const hit = matchCinema(
      { id: 177, name: "Et nyt navn", city: "Haderslev" },
      [cinema({ ebillet_organizer_id: 177 })],
    );
    expect(hit?.id).toBe("c1");
  });

  it("matches one exact venue in the same city despite postcode formatting", () => {
    const hit = matchCinema(
      { id: 177, name: "Kosmorama", city: "DK-6100 Haderslev" },
      [cinema()],
    );
    expect(hit?.id).toBe("c1");
  });

  it("never steals a cinema claimed by another organizer", () => {
    const hit = matchCinema(
      { id: 177, name: "Kosmorama", city: "Haderslev" },
      [cinema({ ebillet_organizer_id: 195 })],
    );
    expect(hit).toBeNull();
  });

  it("refuses two equally plausible cinemas instead of choosing array order", () => {
    const hit = matchCinema(
      { id: 177, name: "Kosmorama", city: "Haderslev" },
      [cinema({ id: "first" }), cinema({ id: "second", slug: "kosmorama-2" })],
    );
    expect(hit).toBeNull();
  });

  it("refuses a same-name cinema in a clearly different city", () => {
    const hit = matchCinema(
      { id: 177, name: "Kosmorama", city: "Haderslev" },
      [cinema({ city: "Fredericia" })],
    );
    expect(hit).toBeNull();
  });
});
