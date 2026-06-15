import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/public/kultunaut-import/process?jobId=...
 * Processes one batch of a queued/running import job. Idempotent —
 * call repeatedly until the returned `done` flag is true.
 */
export const Route = createFileRoute("/api/public/kultunaut-import/process")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.KULTUNAUT_IMPORT_SECRET;
        if (!secret) return new Response("Import secret not configured", { status: 500 });
        const provided = request.headers.get("x-kultunaut-secret");
        if (!provided || provided !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }

        const url = new URL(request.url);
        const jobId = url.searchParams.get("jobId");
        if (!jobId) return new Response("Missing jobId", { status: 400 });

        try {
          const { processJobBatch } = await import("@/lib/kultunaut/import.server");
          const result = await processJobBatch(jobId);
          return Response.json(result);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error("kultunaut-import process failed:", message);
          return new Response(`Process failed: ${message}`, { status: 500 });
        }
      },
    },
  },
});
