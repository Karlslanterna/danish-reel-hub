import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /api/public/import-health
 *
 * Returns a JSON health report for the Kultunaut import pipeline.
 * Suitable for uptime monitors and dashboards. Public read-only:
 * exposes only aggregated counts, timestamps, and status — no PII,
 * no XML payloads, no error message bodies.
 *
 * Response status codes:
 *   200 — healthy
 *   200 — warning (still reachable; caller should alert on `status`)
 *   503 — critical (fires page/paging alerts on uptime monitors)
 */
export const Route = createFileRoute("/api/public/import-health")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { getImportHealth } = await import("@/lib/kultunaut/health.server");
          const { getSchedulerHealth } = await import("@/lib/kultunaut/scheduler.server");
          const [report, scheduler] = await Promise.all([
            getImportHealth(),
            getSchedulerHealth(),
          ]);
          // The scheduler can only make the overall picture worse.
          const rank = { healthy: 0, unknown: 1, warning: 2, critical: 3 } as const;
          const overall =
            rank[scheduler.status] > rank[report.status] ? scheduler.status : report.status;
          const httpStatus = overall === "critical" ? 503 : 200;
          return Response.json(
            { ...report, status: overall, importStatus: report.status, scheduler },
            {
              status: httpStatus,
              headers: {
                "cache-control": "no-store",
                "x-robots-tag": "noindex",
              },
            },
          );

        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error("[import-health] check failed:", message);
          return Response.json(
            { status: "unknown", error: message },
            { status: 500, headers: { "cache-control": "no-store" } },
          );
        }
      },
    },
  },
});
