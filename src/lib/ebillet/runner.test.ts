import { describe, expect, it } from "vitest";
import { shouldStartEbilletCycle } from "./runner.server";

const NOW = Date.parse("2026-08-17T14:30:00.000Z");

describe("shouldStartEbilletCycle", () => {
  it("never enqueues another cycle while organizer jobs are still active", () => {
    expect(
      shouldStartEbilletCycle({
        activeRuns: 84,
        lastCompletedAt: null,
        force: true,
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it("starts the first cycle when there is no completed history", () => {
    expect(
      shouldStartEbilletCycle({ activeRuns: 0, lastCompletedAt: null, nowMs: NOW }),
    ).toBe(true);
  });

  it("does not immediately re-enqueue organizers after a cycle completes", () => {
    expect(
      shouldStartEbilletCycle({
        activeRuns: 0,
        lastCompletedAt: "2026-08-17T14:29:30.000Z",
        nowMs: NOW,
        minIntervalMs: 15 * 60 * 1000,
      }),
    ).toBe(false);
  });

  it("allows the scheduler to start a new cycle after the freshness interval", () => {
    expect(
      shouldStartEbilletCycle({
        activeRuns: 0,
        lastCompletedAt: "2026-08-17T14:00:00.000Z",
        nowMs: NOW,
        minIntervalMs: 15 * 60 * 1000,
      }),
    ).toBe(true);
  });

  it("allows an explicit admin action to start a fresh cycle immediately", () => {
    expect(
      shouldStartEbilletCycle({
        activeRuns: 0,
        lastCompletedAt: "2026-08-17T14:29:59.000Z",
        force: true,
        nowMs: NOW,
      }),
    ).toBe(true);
  });

  it("never starts a new cycle from a resume-only scheduler tick", () => {
    expect(
      shouldStartEbilletCycle({
        activeRuns: 0,
        lastCompletedAt: "2026-08-17T12:00:00.000Z",
        allowStart: false,
        force: true,
        nowMs: NOW,
      }),
    ).toBe(false);
  });
});
