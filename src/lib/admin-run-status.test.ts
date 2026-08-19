import { describe, expect, it } from "vitest";
import {
  isSupersededActiveRun,
  summarizeAdminSourceRuns,
  type AdminImportRun,
} from "./admin-run-status";

const run = (
  value: Partial<AdminImportRun> & Pick<AdminImportRun, "id" | "state">,
): AdminImportRun => ({
  source: "kultunaut",
  created_at: "2026-08-19T02:00:00Z",
  updated_at: "2026-08-19T02:01:00Z",
  finished_at: null,
  ...value,
});

describe("admin import status", () => {
  it("ignores a stale queued run when a newer import completed", () => {
    const stale = run({
      id: "stale",
      state: "queued",
      created_at: "2026-08-17T12:22:00Z",
      updated_at: "2026-08-17T12:58:00Z",
    });
    const completed = run({
      id: "completed",
      state: "completed",
      finished_at: "2026-08-19T02:01:00Z",
    });
    const summary = summarizeAdminSourceRuns(
      [stale, completed],
      "kultunaut",
      new Date("2026-08-19T12:00:00Z"),
    );

    expect(summary).toMatchObject({
      status: "healthy",
      queued: 0,
      running: 0,
      staleActiveRuns: 0,
      latestState: "completed",
    });
    expect(isSupersededActiveRun(stale, summary.latestSuccessAt)).toBe(true);
  });

  it("still warns about a queue created after the latest success", () => {
    const completed = run({
      id: "completed",
      state: "completed",
      created_at: "2026-08-19T01:00:00Z",
      finished_at: "2026-08-19T01:01:00Z",
    });
    const queued = run({
      id: "queued",
      state: "queued",
      created_at: "2026-08-19T11:00:00Z",
      updated_at: "2026-08-19T11:59:00Z",
    });
    const summary = summarizeAdminSourceRuns(
      [completed, queued],
      "kultunaut",
      new Date("2026-08-19T12:00:00Z"),
    );

    expect(summary).toMatchObject({ status: "warning", queued: 1, latestState: "queued" });
  });

  it("keeps a failed run critical until a newer success resolves it", () => {
    const completed = run({
      id: "completed",
      state: "completed",
      created_at: "2026-08-19T01:00:00Z",
      finished_at: "2026-08-19T01:01:00Z",
    });
    const failed = run({
      id: "failed",
      state: "failed",
      created_at: "2026-08-19T03:00:00Z",
      updated_at: "2026-08-19T03:01:00Z",
      finished_at: "2026-08-19T03:01:00Z",
    });

    expect(
      summarizeAdminSourceRuns([completed, failed], "kultunaut", new Date("2026-08-19T12:00:00Z")),
    ).toMatchObject({ status: "critical", failedSinceSuccess: 1 });
  });
});
