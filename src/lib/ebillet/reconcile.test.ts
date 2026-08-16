import { describe, expect, it } from "vitest";
import {
  diffShowtimes,
  matchMovie,
  validateSnapshot,
  type DesiredShowtime,
  type ExistingShowtime,
} from "./reconcile";
import type { EbilletMoviesResponse } from "./api.server";

const ORG = 177;
const soon = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 19);

const payload = (over: Partial<EbilletMoviesResponse> = {}): EbilletMoviesResponse => ({
  organizers: [{ id: ORG, name: "Testbio" }],
  movieBases: [{ id: 10, name: "Dune" }],
  movies: [{ id: 100, baseId: 10, name: "Dune" }],
  showtimes: [
    { id: 1, movieId: 100, movieBaseId: 10, locationId: 1, organizerId: ORG, dateTime: soon(2) },
  ],
  showtimeTypes: [],
  ...over,
});

const desired = (over: Partial<DesiredShowtime> = {}): DesiredShowtime => ({
  movie_id: "m1",
  cinema_id: "c1",
  date: "2026-09-01",
  hall: "Sal 1",
  times: ["18:00"],
  ticket_urls: ["u"],
  ticket_url: "u",
  booking_url: "u",
  start_time: null,
  formats: [],
  languages: [],
  events: [],
  ebillet_showtime_ids: [1],
  free_seats: null,
  min_price: null,
  max_price: null,
  external_id: "eb-177-1",
  ...over,
});

const existing = (over: Partial<ExistingShowtime> = {}): ExistingShowtime => ({
  id: "row-1",
  movie_id: "m1",
  date: "2026-09-01",
  hall: "Sal 1",
  source: "ebillet",
  ebillet_showtime_ids: [1],
  ...over,
});

describe("validateSnapshot", () => {
  it("accepts a healthy payload", () => {
    expect(validateSnapshot(ORG, payload(), { existingRowCount: 5 }).ok).toBe(true);
  });

  it("rejects a payload without the organizer", () => {
    const res = validateSnapshot(ORG, payload({ organizers: [] }), { existingRowCount: 5 });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/mangler i payload/);
  });

  it("rejects duplicate showtime ids", () => {
    const p = payload();
    p.showtimes = [p.showtimes[0]!, { ...p.showtimes[0]! }];
    const res = validateSnapshot(ORG, p, { existingRowCount: 1 });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/duplikeret/);
  });

  it("rejects showtimes referencing unknown movies", () => {
    const res = validateSnapshot(ORG, payload({ movies: [] }), { existingRowCount: 1 });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/ukendt film/);
  });

  it("rejects implausible dates", () => {
    const p = payload();
    p.showtimes[0]!.dateTime = "1975-01-01T20:00:00";
    expect(validateSnapshot(ORG, p, { existingRowCount: 1 }).ok).toBe(false);
  });

  it("rejects a suspicious empty payload for a populated cinema", () => {
    const res = validateSnapshot(ORG, payload({ showtimes: [] }), { existingRowCount: 42 });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/mistænkelig/);
  });

  it("accepts a coherently empty snapshot", () => {
    const res = validateSnapshot(
      ORG,
      payload({ showtimes: [], movies: [], movieBases: [] }),
      { existingRowCount: 42 },
    );
    expect(res.ok).toBe(true);
  });
});

describe("diffShowtimes", () => {
  it("inserts new showtimes", () => {
    const diff = diffShowtimes([], [desired()]);
    expect(diff.inserts).toHaveLength(1);
    expect(diff.updates).toHaveLength(0);
    expect(diff.deleteIds).toEqual([]);
  });

  it("deletes stale eBillet showtimes missing from the snapshot", () => {
    const diff = diffShowtimes([existing({ id: "stale", ebillet_showtime_ids: [99] })], []);
    expect(diff.deleteIds).toEqual(["stale"]);
  });

  it("does not retain a stale eBillet row when the film moved date", () => {
    const diff = diffShowtimes(
      [existing({ id: "old", date: "2026-08-01", ebillet_showtime_ids: [7] })],
      [desired({ date: "2026-09-01", ebillet_showtime_ids: [8] })],
    );
    expect(diff.inserts).toHaveLength(1);
    expect(diff.deleteIds).toEqual(["old"]);
  });

  it("never deletes Kultunaut-only rows", () => {
    const diff = diffShowtimes(
      [existing({ id: "kn", source: "kultunaut", ebillet_showtime_ids: [] })],
      [],
    );
    expect(diff.deleteIds).toEqual([]);
  });

  it("keeps everything when deletes are disallowed (invalid payload)", () => {
    const diff = diffShowtimes([existing()], [], { allowDeletes: false });
    expect(diff.deleteIds).toEqual([]);
  });

  it("is idempotent on a repeat sync", () => {
    const rows = [existing()];
    const first = diffShowtimes(rows, [desired()]);
    expect(first.inserts).toHaveLength(0);
    expect(first.updates).toHaveLength(1);
    expect(first.deleteIds).toEqual([]);
    const second = diffShowtimes(rows, [desired()]);
    expect(second).toEqual(first);
  });

  it("matches on stable eBillet ids even when hall naming changed", () => {
    const diff = diffShowtimes([existing({ hall: "Sal" })], [desired({ hall: "Store sal" })]);
    expect(diff.updates).toHaveLength(1);
    expect(diff.deleteIds).toEqual([]);
  });
});

describe("matchMovie", () => {
  const base = {
    id: "kn-1",
    title: "Dune",
    year: 2021,
    ebillet_movie_base_id: null,
    ebillet_movie_ids: null,
  };

  it("matches on baseId first", () => {
    const hit = matchMovie(
      { baseId: 10, movieIds: [], title: "Noget helt andet", year: null },
      [{ ...base, ebillet_movie_base_id: 10 }],
    );
    expect(hit?.id).toBe("kn-1");
  });

  it("matches on known eBillet movie ids", () => {
    const hit = matchMovie({ baseId: null, movieIds: [100], title: "X", year: null }, [
      { ...base, ebillet_movie_ids: [100] },
    ]);
    expect(hit?.id).toBe("kn-1");
  });

  it("does not merge on title alone", () => {
    expect(
      matchMovie({ baseId: 5, movieIds: [1], title: "Dune", year: null }, [base]),
    ).toBeNull();
  });

  it("merges on title + matching year", () => {
    const hit = matchMovie({ baseId: 5, movieIds: [1], title: "Dune (2021)", year: 2021 }, [base]);
    expect(hit?.id).toBe("kn-1");
  });

  it("refuses an ambiguous title collision", () => {
    expect(
      matchMovie({ baseId: 5, movieIds: [1], title: "Dune", year: 2021 }, [
        base,
        { ...base, id: "kn-2" },
      ]),
    ).toBeNull();
  });

  it("refuses a remake with a different year", () => {
    expect(
      matchMovie({ baseId: 5, movieIds: [1], title: "Dune", year: 1984 }, [base]),
    ).toBeNull();
  });
});
