import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/public/ebillet-sync
 *
 * Scheduled entry point for eBillet. Canonical sync jobs use the shared
 * `import_runs` lease model; discovery is registry maintenance only and lives
 * in a separate service that cannot mutate canonical cinema/movie/screening data.
 *
 * Transitional authentication accepts both the generic/eBillet headers and
 * the old Kultunaut-named headers so existing scheduler secrets stay valid.
 *
 *   x-ebillet-mode: discover | sync | resume
 *   - sync: may start a fresh finite organizer cycle and drain it
 *   - resume: may only drain an already queued/running cycle
 *   - discover: registry discovery only
 */
export const Route = createFileRoute("/api/public/ebillet-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifySchedulerToken } = await import("@/lib/kultunaut/scheduler.server");
        const token =
          request.headers.get("x-import-scheduler-token") ??
          request.headers.get("x-kultunaut-cron-token");
        const ebilletSecret = process.env.EBILLET_SYNC_SECRET;
        const legacySecret = process.env.KULTUNAUT_IMPORT_SECRET;
        const suppliedSecret =
          request.headers.get("x-ebillet-secret") ?? request.headers.get("x-kultunaut-secret");
        const viaEnv =
          (!!ebilletSecret && suppliedSecret === ebilletSecret) ||
          (!!legacySecret && suppliedSecret === legacySecret);
        const ok = viaEnv || (await verifySchedulerToken(token));
        if (!ok) return new Response("Unauthorized", { status: 401 });

        const rawMode = request.headers.get("x-ebillet-mode");
        const mode = rawMode === "discover" || rawMode === "resume" ? rawMode : "sync";

        try {
          if (mode === "discover") {
            const { runEbilletDiscoveryJob } = await import("@/lib/ebillet/discovery.server");
            const result = await runEbilletDiscoveryJob({
              trigger: "cron",
              budgetMs: 55_000,
            });
            return Response.json(result, {
              status: result.status === "failed" ? 500 : 200,
              headers: { "cache-control": "no-store" },
            });
          }

          const { runEbilletQueueBatch } = await import("@/lib/ebillet/runner.server");
          const result = await runEbilletQueueBatch(55_000, {
            allowStart: mode === "sync",
          });
          return Response.json(result, {
            status: result.status === "dead_letter" ? 500 : 200,
            headers: { "cache-control": "no-store" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error("[ebillet] scheduler run crashed:", message);
          return Response.json({ status: "failed", reason: "eBillet sync failed" }, { status: 500 });
        }
      },
    },
  },
});
