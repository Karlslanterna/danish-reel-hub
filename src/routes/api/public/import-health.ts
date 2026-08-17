import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /api/public/import-health
 *
 * Public, aggregate-only operational health. The canonical pipeline is the
 * source of truth: eBillet and Kultunaut are evaluated independently so an
 * upstream Kultunaut outage cannot make a healthy eBillet platform look down.
 *
 * During the transition the response also preserves the legacy Kultunaut
 * metrics/scheduler fields consumed by the existing Admin page.
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

          // Legacy fields remain compatibility-only. Failure to produce them
          // must not hide the canonical per-source health report.
          const [legacyImport, scheduler] = await Promise.all([
            import("@/lib/kultunaut/health.server")
              .then(({ getImportHealth }) => getImportHealth())
              .catch(() => null),
            import("@/lib/kultunaut/scheduler.server")
              .then(({ getSchedulerHealth }) => getSchedulerHealth())
              .catch(() => null),
          ]);

          const monitorMode = new URL(request.url).searchParams.get("monitor") === "1";
          const httpStatus = monitorMode && canonical.status === "critical" ? 503 : 200;

          return Response.json(
            {
              // Canonical fields — these determine platform health.
              status: canonical.status,
              reasons: canonical.reasons,
              sources: canonical.sources,
              parity: canonical.parity,
              checkedAt: canonical.checkedAt,

              // Transitional fields expected by the current Admin dashboard.
              importStatus: legacyImport?.status ?? "unknown",
              metrics: legacyImport?.metrics ?? null,
              scheduler,
              kultunautLegacy: legacyImport
                ? { status: legacyImport.status, reasons: legacyImport.reasons }
                : null,
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
              parity: null,
              checkedAt: new Date().toISOString(),
              importStatus: "unknown",
              metrics: null,
              scheduler: null,
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
