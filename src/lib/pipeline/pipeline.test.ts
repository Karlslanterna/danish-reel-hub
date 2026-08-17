import { describe, expect, it } from "vitest";
import { copenhagenParts, copenhagenToUtcIso } from "./localtime";
import {
  dedupeBySourceRef,
  groupByCinemaRef,
  toPromotionRow,
  type NormalizedScreening,
} from "./types";
import { isClaimable, nextStateAfterFailure, MAX_ATTEMPTS } from "./runs.server";
import {
  buildMovieGroups,
  ebilletStartsAt,
  movieRefOf,
  normalizeEbilletScreenings,
  screeningRefOf,
} from "@/lib/ebillet/normalize";
import {
  kultunautScreeningRef,
  normalizeKultunautScreenings,
} from "@/lib/kultunaut/normalize";
import type { EbilletMoviesResponse } from "@/lib/ebillet/api.server";

// ------------------------------------------------------------- local time

describe("Copenhagen time projection", () => {
  it("maps winter wall clock to UTC+1", () => {
    expect(copenhagenToUtcIso("2026-01-15", "19:30")).toBe("2026-01-15T18:30:00.000Z");
  });

  it("maps summer wall clock to UTC+2", () => {
    expect(copenhagenToUtcIso("2026-07-15", "19:30")).toBe("2026-07-15T17:30:00.000Z");
  });

  it("round-trips an instant back to local parts", () => {
    const iso = copenhagenToUtcIso("2026-03-29", "23:15");
    expect(copenhagenParts(iso)).toEqual({ date: "2026-03-29", time: "23:15" });
  });
});

// ------------------------------------------------------------- eBillet

const payload = (overrides: Partial<EbilletMoviesResponse> = {}): EbilletMoviesResponse => ({
  organizers: [{ id: 177, name: "Testbio", address: { city: "Aarhus" } }],
  movieBases: [{ id: 500, name: "Dune" }],
  movies: [
    { id: 900, baseId: 500, name: "Dune 3D", length: "02:35", openingDate: "2026-01-01", is3D: true },
    { id: 901, baseId: 500, name: "Dune 2D", length: "02:35", openingDate: "2026-01-01" },
    { id: 950, baseId: 0, name: "Kortfilm" },
  ],
  showtimes: [
    { id: 1, movieId: 900, movieBaseId: 500, locationId: 1, locationName: "Sal 1", dateTime: "2026-02-01T19:00:00", organizerId: 177, freeSeats: 40, minPrice: 95, maxPrice: 120 },
    { id: 2, movieId: 901, movieBaseId: 500, locationId: 1, locationName: "Sal 1", dateTime: "2026-02-01T21:30:00", organizerId: 177 },
    { id: 3, movieId: 950, movieBaseId: 0, locationId: 2, locationName: "", dateTime: "2026-02-02T12:00:00", organizerId: 177 },
    { id: 4, movieId: 900, movieBaseId: 500, locationId: 1, dateTime: "2026-02-01T19:00:00", organizerId: 999 },
  ],
  showtimeTypes: [],
  ...overrides,
});

describe("eBillet normalization", () => {
  it("uses base id as primary movie identity and falls back to movie id", () => {
    expect(movieRefOf({ id: 900, baseId: 500 })).toBe("base-500");
    expect(movieRefOf({ id: 950, baseId: 0 })).toBe("movie-950");
  });

  it("collapses versions into one group per film", () => {
    const groups = buildMovieGroups(payload());
    expect(groups.map((g) => g.ref).sort()).toEqual(["base-500", "movie-950"]);
    const dune = groups.find((g) => g.ref === "base-500")!;
    expect(dune.movieIds).toEqual([900, 901]);
    expect(dune.title).toBe("Dune");
    expect(dune.runtime).toBe(155);
  });

  it("emits one row per physical screening, scoped to the organizer", () => {
    const rows = normalizeEbilletScreenings(177, payload());
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.sourceCinemaRef === "177")).toBe(true);
    expect(rows.map((r) => r.sourceRef)).toContain(screeningRefOf(1));
    // organizer 999's screening is excluded
    expect(rows.map((r) => r.sourceRef)).not.toContain(screeningRefOf(4));
  });

  it("is idempotent: the same payload yields identical identities", () => {
    const a = normalizeEbilletScreenings(177, payload());
    const b = normalizeEbilletScreenings(177, payload());
    expect(a.map((r) => r.sourceRef)).toEqual(b.map((r) => r.sourceRef));
    expect(a.map((r) => r.startsAt)).toEqual(b.map((r) => r.startsAt));
  });

  it("treats offset-less eBillet timestamps as Danish wall clock", () => {
    expect(ebilletStartsAt("2026-02-01T19:00:00")).toBe("2026-02-01T18:00:00.000Z");
    expect(ebilletStartsAt("2026-02-01T19:00:00+01:00")).toBe("2026-02-01T18:00:00.000Z");
  });

  it("keeps price and seat metadata per screening", () => {
    const row = normalizeEbilletScreenings(177, payload()).find((r) => r.sourceRef === "eb-1")!;
    expect(row.priceMin).toBe(95);
    expect(row.priceMax).toBe(120);
    expect(row.freeSeats).toBe(40);
    expect(row.formats).toContain("3D");
    expect(row.hall).toBe("Sal 1");
  });
});

// ------------------------------------------------------------- Kultunaut

describe("Kultunaut normalization", () => {
  const showtimes = [
    {
      movie_external_id: "m1",
      cinema_external_id: "c1",
      date: "2026-02-01",
      times: ["19:00", "21:30"],
      hall: "Sal 1",
      ticket_url: "https://tickets/1",
      formats: ["2D"],
      languages: [],
      events: [],
    },
  ];

  it("explodes times[] into one screening per time", () => {
    const rows = normalizeKultunautScreenings(showtimes);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.localTime)).toEqual(["19:00", "21:30"]);
  });

  it("produces deterministic identities across repeated imports", () => {
    const first = normalizeKultunautScreenings(showtimes).map((r) => r.sourceRef);
    const second = normalizeKultunautScreenings(showtimes).map((r) => r.sourceRef);
    expect(first).toEqual(second);
    expect(first[0]).toBe(
      kultunautScreeningRef({
        cinemaExternalId: "c1",
        movieExternalId: "m1",
        date: "2026-02-01",
        time: "19:00",
        hall: "Sal 1",
      }),
    );
  });

  it("drops malformed times instead of inventing screenings", () => {
    const rows = normalizeKultunautScreenings([
      { ...showtimes[0], times: ["19:00", "kl. 21", ""] },
    ]);
    expect(rows).toHaveLength(1);
  });

  it("keeps different halls distinct", () => {
    const rows = normalizeKultunautScreenings([
      showtimes[0],
      { ...showtimes[0], hall: "Sal 2" },
    ]);
    expect(new Set(rows.map((r) => r.sourceRef)).size).toBe(4);
  });
});

// ------------------------------------------------------------- pipeline glue

describe("promotion shaping", () => {
  const base: NormalizedScreening = {
    sourceRef: "eb-1",
    sourceCinemaRef: "177",
    sourceMovieRef: "base-500",
    startsAt: "2026-02-01T18:00:00.000Z",
    localDate: "2026-02-01",
    localTime: "19:00",
    hall: "Sal 1",
    ticketUrl: null,
    priceMin: null,
    priceMax: null,
    freeSeats: null,
    formats: [],
    languages: [],
    events: [],
  };

  it("groups rows by cinema scope so promotion stays scoped", () => {
    const grouped = groupByCinemaRef([base, { ...base, sourceRef: "eb-2", sourceCinemaRef: "195" }]);
    expect([...grouped.keys()]).toEqual(["177", "195"]);
    expect(grouped.get("177")).toHaveLength(1);
  });

  it("dedupes repeated source refs (last write wins)", () => {
    const rows = dedupeBySourceRef([base, { ...base, hall: "Sal 2" }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].hall).toBe("Sal 2");
  });

  it("maps a normalized screening onto the RPC row shape", () => {
    const row = toPromotionRow(base, "eb-base-500");
    expect(row).toMatchObject({ source_ref: "eb-1", movie_id: "eb-base-500", hall: "Sal 1" });
    expect(row).not.toHaveProperty("localDate");
  });
});

// ------------------------------------------------------------- run leases

describe("run lease semantics (worker crash recovery)", () => {
  const now = new Date("2026-02-01T12:00:00Z");

  it("does not steal a run with a live lease", () => {
    expect(
      isClaimable({ state: "running", leaseUntil: "2026-02-01T12:01:00Z" }, now),
    ).toBe(false);
  });

  it("reclaims a run whose worker died (expired lease)", () => {
    expect(
      isClaimable({ state: "running", leaseUntil: "2026-02-01T11:59:00Z" }, now),
    ).toBe(true);
  });

  it("claims a fresh queued run", () => {
    expect(isClaimable({ state: "queued", leaseUntil: null }, now)).toBe(true);
  });

  it("never re-claims a finished run", () => {
    expect(isClaimable({ state: "completed", leaseUntil: null }, now)).toBe(false);
  });

  it("dead-letters a run after too many attempts", () => {
    expect(nextStateAfterFailure(1)).toBe("queued");
    expect(nextStateAfterFailure(MAX_ATTEMPTS)).toBe("dead_letter");
  });
});
