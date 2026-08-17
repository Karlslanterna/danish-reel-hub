import { describe, expect, it } from "vitest";
import {
  partitionByAuthority,
  showtimeKey,
  staleKultunautShowtimeIds,
  type ExistingShowtimeRow,
} from "./reconcile";
import { validateSnapshot, diffShowtimes } from "@/lib/ebillet/reconcile";
import type { EbilletMoviesResponse } from "@/lib/ebillet/api.server";

const row = (over: Partial<ExistingShowtimeRow> = {}): ExistingShowtimeRow => ({
  id: "s1",
  movie_id: "m1",
  cinema_id: "kn-1",
  date: "2026-08-20",
  hall: "Sal 1",
  source: "kultunaut",
  ...over,
});

describe("kultunaut source authority", () => {
  it("never lets Kultunaut write to an eBillet-owned cinema", () => {
    const { writable, skipped } = partitionByAuthority(
      [{ cinema_id: "kn-1" }, { cinema_id: "eb-9" }],
      new Set(["eb-9"]),
    );
    expect(writable).toEqual([{ cinema_id: "kn-1" }]);
    expect(skipped).toEqual([{ cinema_id: "eb-9" }]);
  });

  it("removes a Kultunaut showtime that left the feed, within Kultunaut scope", () => {
    const existing = [row({ id: "gone" }), row({ id: "kept", date: "2026-08-21" })];
    const desired = [{ movie_id: "m1", cinema_id: "kn-1", date: "2026-08-21", hall: "Sal 1" }];
    expect(staleKultunautShowtimeIds(existing, desired, new Set())).toEqual(["gone"]);
  });

  it("cleanup can never delete eBillet rows", () => {
    const existing = [
      row({ id: "eb-row", source: "ebillet", cinema_id: "eb-9" }),
      row({ id: "kn-on-eb-cinema", cinema_id: "eb-9" }),
    ];
    expect(staleKultunautShowtimeIds(existing, [], new Set(["eb-9"]))).toEqual([]);
  });

  it("is idempotent: a repeated import removes nothing and keys are stable", () => {
    const existing = [row()];
    const desired = existing.map(({ movie_id, cinema_id, date, hall }) => ({
      movie_id,
      cinema_id,
      date,
      hall,
    }));
    expect(staleKultunautShowtimeIds(existing, desired, new Set())).toEqual([]);
    expect(showtimeKey(existing[0]!)).toBe(showtimeKey(desired[0]!));
  });
});

const payload = (over: Partial<EbilletMoviesResponse> = {}): EbilletMoviesResponse => ({
  organizers: [{ id: 1, name: "Bio" }],
  movieBases: [],
  movies: [],
  showtimes: [],
  showtimeTypes: [],
  ...over,
});

describe("eBillet destructive-write guards", () => {
  it("rejects a suspiciously empty payload for a populated cinema", () => {
    const res = validateSnapshot(
      1,
      payload({ movies: [{ id: 5, baseId: 5, name: "Film" } as never] }),
      { existingRowCount: 40 },
    );
    expect(res.ok).toBe(false);
    expect(res.allowDeletes).toBe(false);
  });

  it("keeps existing rows when deletes are disallowed", () => {
    const diff = diffShowtimes(
      [{ id: "x", movie_id: "m", date: "2026-08-20", hall: "1", source: "ebillet", ebillet_showtime_ids: [7] }],
      [],
      { allowDeletes: false },
    );
    expect(diff.deleteIds).toEqual([]);
  });
});
