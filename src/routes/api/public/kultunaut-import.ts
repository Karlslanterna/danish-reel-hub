import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/public/kultunaut-import
 *
 * Two modes on the SAME endpoint (no new public surface):
 *  1. Manual: body = Kultunaut XML → creates a background import job and
 *     returns `{ jobId }`. Processing is driven by polling
 *     /api/public/kultunaut-import/process and .../status.
 *  2. Scheduled: header `x-kultunaut-mode: scheduled` (sent by the daily
 *     pg_cron job) → runs the automated scheduler, which fetches the feed,
 *     creates the job, drains it and refreshes import health.
 *
 * Auth (both modes): header `x-kultunaut-secret: <KULTUNAUT_IMPORT_SECRET>`.
 */
export const Route = createFileRoute("/api/public/kultunaut-import")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const mode = request.headers.get("x-kultunaut-mode");
        const isScheduler = mode === "scheduled" || mode === "resume";

        if (isScheduler) {
          // The scheduler authenticates with a token generated inside the
          // database and readable only by service_role (never exposed).
          const { verifySchedulerToken } = await import("@/lib/kultunaut/scheduler.server");
          const token = request.headers.get("x-kultunaut-cron-token");
          const envSecret = process.env.KULTUNAUT_IMPORT_SECRET;
          const viaEnv =
            !!envSecret && request.headers.get("x-kultunaut-secret") === envSecret;
          const ok = viaEnv || (await verifySchedulerToken(token));
          if (!ok) return new Response("Unauthorized", { status: 401 });
        } else {
          const secret = process.env.KULTUNAUT_IMPORT_SECRET;
          if (!secret) {
            return new Response("Import secret not configured", { status: 500 });
          }
          const provided = request.headers.get("x-kultunaut-secret");
          if (!provided || provided !== secret) {
            return new Response("Unauthorized", { status: 401 });
          }
        }

        if (isScheduler) {

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
            return Response.json({ status: "failed", reason: message }, { status: 500 });
          }
        }

        const body = await request.text();
        if (!body) return new Response("Empty body", { status: 400 });
        if (body.length > 20_000_000) {
          return new Response("Payload too large (max 20MB)", { status: 413 });
        }


        try {
          const { createImportJob } = await import("@/lib/kultunaut/pipeline.server");
          const { jobId } = await createImportJob(body);
          return Response.json({ jobId, status: "queued" }, { status: 202 });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error("kultunaut-import create failed:", message);
          return new Response(`Failed to queue import: ${message}`, { status: 500 });
        }
      },
    },
  },
});
