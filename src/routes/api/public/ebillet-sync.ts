import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/public/ebillet-sync
 *
 * Scheduled entry point for eBillet. Canonical sync jobs use the shared
 * `import_runs` lease model; discovery remains a separate registry scan.
 *
 * Transitional authentication accepts both the new generic/eBillet headers and
 * the old Kultunaut-named headers so the existing scheduler does not break.
 *
 *   header x-ebillet-mode: discover | sync   (default: sync)
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

        const mode = request.headers.get("x-ebillet-mode") === "discover" ? "discover" : "sync";

        try {
          if (mode === "discover") {
            // Discovery only maintains the organizer registry. It does not
            // promote screenings and can remain on the legacy discovery code.
            const { runEbilletJob } = await import("@/lib/ebillet/sync.server");
            const result = await runEbilletJob({
              kind: "discover",
              trigger: "cron",
              budgetMs: 55_000,
            });
            return Response.json(result, {
              status: result.status === "failed" ? 500 : 200,
              headers: { "cache-control": "no-store" },
            });
          }

          const { runEbilletQueueBatch } = await import("@/lib/ebillet/runner.server");
          const result = await runEbilletQueueBatch(55_000);
          return Response.json(result, {
            status: result.status === "dead_letter" ? 500 : 200,
            headers: { "cache-control": "no-store" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error("[ebillet] scheduler run crashed:", message);
          // The authenticated scheduler only needs a stable failure signal;
          // detailed stack/data stays in server logs rather than the response.
          return Response.json({ status: "failed", reason: "eBillet sync failed" }, { status: 500 });
        }
      },
    },
  },
});
