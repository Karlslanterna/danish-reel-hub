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
 * `?monitor=1` is intentionally stricter than the public headline. It returns
 * 503 if either source is operationally stale/broken even when the other source
 * keeps the public site usable. Data-quality warnings such as unresolved entity
 * mappings alone do not page.
 */
export const Route = createFileRoute("/api/public/import-health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { getCanonicalPipelineHealth } = await import("@/lib/pipeline/health.server");
          const { operationalImportFailures } = await import("@/lib/pipeline/operational-monitor");
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
          const monitorFailures = operationalImportFailures(canonical);
          const httpStatus = monitorMode && monitorFailures.length > 0 ? 503 : 200;

          return Response.json(
            {
              // Canonical fields — these determine platform health.
              status: canonical.status,
              reasons: canonical.reasons,
              sources: canonical.sources,
              parity: canonical.parity,
              checkedAt: canonical.checkedAt,
              ...(monitorMode
                ? {
                    monitor: {
                      status: monitorFailures.length > 0 ? "failing" : "healthy",
                      failures: monitorFailures,
                    },
                  }
                : {}),

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
              ...(new URL(request.url).searchParams.get("monitor") === "1"
                ? {
                    monitor: {
                      status: "failing",
                      failures: ["Import health check is unavailable"],
                    },
                  }
                : {}),
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
