import { describe, expect, it } from "vitest";
import { unresolvedDeadLetterScopes, type HealthRunRow } from "./health.server";

const run = (
  state: string,
  scopeKey: string,
  createdAt: string,
): HealthRunRow => ({
  state,
  scope_type: "organizer",
  scope_key: scopeKey,
  created_at: createdAt,
  updated_at: createdAt,
  finished_at: createdAt,
});

describe("unresolvedDeadLetterScopes", () => {
  it("counts a scope whose latest run is dead-lettered", () => {
    expect(
      unresolvedDeadLetterScopes([
        run("dead_letter", "177", "2026-08-17T14:00:00Z"),
        run("completed", "177", "2026-08-17T13:00:00Z"),
      ]),
    ).toBe(1);
  });

  it("does not keep health critical after the same scope later succeeds", () => {
    expect(
      unresolvedDeadLetterScopes([
        run("completed", "177", "2026-08-17T14:00:00Z"),
        run("dead_letter", "177", "2026-08-17T13:00:00Z"),
      ]),
    ).toBe(0);
  });

  it("evaluates each organizer independently", () => {
    expect(
      unresolvedDeadLetterScopes([
        run("completed", "177", "2026-08-17T14:00:00Z"),
        run("dead_letter", "177", "2026-08-17T13:00:00Z"),
        run("dead_letter", "195", "2026-08-17T14:05:00Z"),
        run("completed", "195", "2026-08-17T12:00:00Z"),
      ]),
    ).toBe(1);
  });
});
