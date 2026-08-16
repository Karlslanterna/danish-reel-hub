import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/public/ebillet-sync
 *
 * Scheduled entry point for the eBillet integration (driven by pg_cron the
 * same way as the Kultunaut import). Authenticated with the internal
 * scheduler token, or the operator secret for manual triggers.
 *
 *   header x-ebillet-mode: discover | sync   (default: sync)
 */
export const Route = createFileRoute("/api/public/ebillet-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifySchedulerToken } = await import("@/lib/kultunaut/scheduler.server");
        const token = request.headers.get("x-kultunaut-cron-token");
        const envSecret = process.env.KULTUNAUT_IMPORT_SECRET;
        const viaEnv =
          !!envSecret && request.headers.get("x-kultunaut-secret") === envSecret;
        const ok = viaEnv || (await verifySchedulerToken(token));
        if (!ok) return new Response("Unauthorized", { status: 401 });

        const mode = request.headers.get("x-ebillet-mode") === "discover" ? "discover" : "sync";

        try {
          const { runEbilletJob, reapStaleEbilletRuns } = await import(
            "@/lib/ebillet/sync.server"
          );
          await reapStaleEbilletRuns(60);
          // Leave headroom for the serverless runtime so the resumable cursor
          // is persisted before the invocation is forcibly terminated.
          const result = await runEbilletJob({
            kind: mode,
            trigger: "cron",
            budgetMs: 60_000,
          });
          return Response.json(result, {
            status: result.status === "failed" ? 500 : 200,
            headers: { "cache-control": "no-store" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error("[ebillet] run crashed:", message);
          return Response.json({ status: "failed", reason: message }, { status: 500 });
        }
      },
    },
  },
});
