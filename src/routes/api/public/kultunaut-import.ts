import { createFileRoute } from "@tanstack/react-router";

/**
 * Internal scheduler endpoint for the automated Kultunaut import.
 *
 * Manual XML uploads are handled inside the authenticated admin area and no
 * longer use a public API route. Only the database scheduler may call this
 * endpoint, using either its private cron token or the server-side import
 * secret.
 */
export const Route = createFileRoute("/api/public/kultunaut-import")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const mode = request.headers.get("x-kultunaut-mode");
        if (mode !== "scheduled" && mode !== "resume") {
          return new Response("Not found", { status: 404 });
        }

        const { verifySchedulerToken } = await import("@/lib/kultunaut/scheduler.server");
        const token = request.headers.get("x-kultunaut-cron-token");
        const envSecret = process.env.KULTUNAUT_IMPORT_SECRET;
        const viaEnv = !!envSecret && request.headers.get("x-kultunaut-secret") === envSecret;
        const authorized = viaEnv || (await verifySchedulerToken(token));
        if (!authorized) return new Response("Unauthorized", { status: 401 });

        try {
          const { runScheduledImport } = await import("@/lib/kultunaut/scheduler.server");
          const result =
            mode === "resume"
              ? await runScheduledImport("resume", true)
              : await runScheduledImport("cron");

          return Response.json(result, {
            status: result.status === "failed" ? 500 : 200,
            headers: { "cache-control": "no-store" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error("[import-scheduler] run crashed:", message);
          return Response.json(
            { status: "failed", reason: "Kultunaut scheduler failed" },
            { status: 500, headers: { "cache-control": "no-store" } },
          );
        }
      },
    },
  },
});
