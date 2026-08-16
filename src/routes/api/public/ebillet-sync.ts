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

          // Each runEbilletJob("sync") call handles exactly one organizer and
          // commits the cursor, so the cron invocation simply repeats batches
          // until it runs out of wall-clock budget. Nothing is lost when the
          // runtime terminates us mid-way — the next cron tick resumes.
          const deadline = Date.now() + 60_000;
          let result = await runEbilletJob({ kind: mode, trigger: "cron", budgetMs: 60_000 });
          if (mode === "sync") {
            while (!result.done && Date.now() < deadline) {
              result = await runEbilletJob({ kind: "sync", trigger: "cron" });
            }
          }
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
