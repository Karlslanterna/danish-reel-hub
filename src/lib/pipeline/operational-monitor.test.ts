import { describe, expect, it } from "vitest";
import type { CanonicalPipelineHealth, SourcePipelineHealth } from "./health.server";
import { operationalImportFailures } from "./operational-monitor";

const source = (
  sourceName: "ebillet" | "kultunaut",
  overrides: Partial<SourcePipelineHealth> = {},
): SourcePipelineHealth => ({
  source: sourceName,
  status: "healthy",
  reasons: ["All canonical source checks passed"],
  lastRunAt: "2026-08-21T08:00:00.000Z",
  lastRunState: "completed",
  lastSuccessAt: "2026-08-21T08:00:00.000Z",
  hoursSinceLastSuccess: 2,
  canonicalScreenings: 1000,
  futureScreenings: 900,
  queuedRuns: 0,
  runningRuns: 0,
  deadLetterRuns: 0,
  unresolvedMappings: 0,
  ...overrides,
});

const health = (
  ebillet: SourcePipelineHealth,
  kultunaut: SourcePipelineHealth,
): CanonicalPipelineHealth => ({
  status: "healthy",
  reasons: [],
  sources: { ebillet, kultunaut },
  parity: {
    available: true,
    mismatchGroups: 0,
    totalAbsoluteDelta: 0,
    bySource: {
      ebillet: { mismatchGroups: 0, totalAbsoluteDelta: 0 },
      kultunaut: { mismatchGroups: 0, totalAbsoluteDelta: 0 },
    },
    truncated: false,
  },
  checkedAt: "2026-08-21T10:00:00.000Z",
});

describe("operational import monitoring", () => {
  it("stays quiet when both source pipelines are current", () => {
    expect(operationalImportFailures(health(source("ebillet"), source("kultunaut")))).toEqual([]);
  });

  it("alerts when Kultunaut is stale even if the platform headline could remain usable", () => {
    const failures = operationalImportFailures(
      health(source("ebillet"), source("kultunaut", { hoursSinceLastSuccess: 30, status: "warning" })),
    );
    expect(failures).toEqual(["Kultunaut: last canonical success was 30.0h ago"]);
  });

  it("alerts on missing success, dead letters and missing future data", () => {
    const failures = operationalImportFailures(
      health(
        source("ebillet", { deadLetterRuns: 1 }),
        source("kultunaut", {
          lastSuccessAt: null,
          hoursSinceLastSuccess: null,
          futureScreenings: 0,
        }),
      ),
    );
    expect(failures).toEqual(
      expect.arrayContaining([
        "eBillet: 1 unresolved dead-letter scope(s)",
        "Kultunaut: no completed canonical import is recorded",
        "Kultunaut: zero future canonical screenings",
      ]),
    );
  });

  it("does not page for unresolved mappings alone", () => {
    expect(
      operationalImportFailures(
        health(source("ebillet", { unresolvedMappings: 4, status: "warning" }), source("kultunaut")),
      ),
    ).toEqual([]);
  });
});
