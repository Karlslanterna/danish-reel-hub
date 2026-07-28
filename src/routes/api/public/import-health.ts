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
          const report = await getImportHealth();
          const httpStatus = report.status === "critical" ? 503 : 200;
          return Response.json(report, {
            status: httpStatus,
            headers: {
              "cache-control": "no-store",
              "x-robots-tag": "noindex",
            },
          });
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
