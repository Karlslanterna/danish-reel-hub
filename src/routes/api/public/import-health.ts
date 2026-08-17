import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /api/public/import-health
 *
 * Public, aggregate-only operational health. The canonical pipeline is the
 * source of truth: eBillet and Kultunaut are evaluated independently so an
 * upstream Kultunaut outage cannot make a healthy eBillet platform look down.
 * Legacy Kultunaut scheduler health is included only as supplemental context.
 *
 * ?monitor=1 returns HTTP 503 only when canonical health is critical.
 */
export const Route = createFileRoute("/api/public/import-health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { getCanonicalPipelineHealth } = await import("@/lib/pipeline/health.server");
          const canonical = await getCanonicalPipelineHealth();

          // Scheduler/legacy health is useful while Kultunaut finishes its
          // migration, but it must never override canonical source health.
          const [legacyImport, scheduler] = await Promise.all([
            import("@/lib/kultunaut/health.server")
              .then(({ getImportHealth }) => getImportHealth())
              .then((report) => ({ status: report.status, reasons: report.reasons }))
              .catch(() => null),
            import("@/lib/kultunaut/scheduler.server")
              .then(({ getSchedulerHealth }) => getSchedulerHealth())
              .catch(() => null),
          ]);

          const monitorMode = new URL(request.url).searchParams.get("monitor") === "1";
          const httpStatus = monitorMode && canonical.status === "critical" ? 503 : 200;

          return Response.json(
            {
              status: canonical.status,
              reasons: canonical.reasons,
              sources: canonical.sources,
              checkedAt: canonical.checkedAt,
              kultunautLegacy: {
                import: legacyImport,
                scheduler,
              },
            },
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
          console.error("[import-health] canonical health check failed:", message);
          // Do not expose database/table/error details on a public endpoint.
          return Response.json(
            {
              status: "unknown",
              reasons: ["Import health is temporarily unavailable"],
              sources: null,
              checkedAt: new Date().toISOString(),
            },
            {
              status: 500,
              headers: {
                "cache-control": "no-store",
                "x-robots-tag": "noindex",
              },
            },
          );
        }
      },
    },
  },
});
