import { describe, expect, it } from "vitest";
import { validateKultunautSnapshot } from "./snapshot";

const base = {
  xmlLength: 100_000,
  movies: 117,
  cinemas: 159,
  showtimes: 5005,
  grouped: 2942,
};

describe("validateKultunautSnapshot", () => {
  it("accepts a healthy full snapshot", () => {
    const r = validateKultunautSnapshot(base);
    expect(r.verdict).toBe("complete");
    expect(r.reconcileRemovals).toBe(true);
  });

  it("rejects a truncated xml payload", () => {
    const r = validateKultunautSnapshot({ ...base, xmlLength: 42 });
    expect(r.verdict).toBe("incomplete");
    expect(r.reconcileRemovals).toBe(false);
  });

  it("never infers valid-empty from an empty payload", () => {
    const r = validateKultunautSnapshot({
      xmlLength: 100_000,
      movies: 0,
      cinemas: 0,
      showtimes: 0,
      grouped: 0,
    });
    expect(r.verdict).toBe("incomplete");
    expect(r.reconcileRemovals).toBe(false);
  });

  it("allows removals only when the caller explicitly declares an empty feed", () => {
    const r = validateKultunautSnapshot({
      xmlLength: 800,
      movies: 0,
      cinemas: 0,
      showtimes: 0,
      grouped: 0,
      declaredEmpty: true,
    });
    expect(r.verdict).toBe("valid-empty");
    expect(r.reconcileRemovals).toBe(true);
  });

  it("rejects a payload with showtimes but no movies", () => {
    const r = validateKultunautSnapshot({ ...base, movies: 0 });
    expect(r.reconcileRemovals).toBe(false);
  });

  it("rejects an implausibly thin snapshot", () => {
    const r = validateKultunautSnapshot({
      ...base,
      showtimes: 3,
      grouped: 3,
    });
    expect(r.reconcileRemovals).toBe(false);
  });
});
