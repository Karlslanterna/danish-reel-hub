import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /api/public/kultunaut-import/status?jobId=...
 * Returns the current status snapshot for an import job.
 */
export const Route = createFileRoute("/api/public/kultunaut-import/status")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.KULTUNAUT_IMPORT_SECRET;
        if (!secret) return new Response("Import unavailable", { status: 503 });
        const provided = request.headers.get("x-kultunaut-secret");
        if (!provided || provided !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }

        const url = new URL(request.url);
        const jobId = url.searchParams.get("jobId");
        if (!jobId) return new Response("Missing jobId", { status: 400 });

        try {
          const { getJobStatus } = await import("@/lib/kultunaut/pipeline.server");
          const job = await getJobStatus(jobId);
          if (!job) return new Response("Not found", { status: 404 });
          return Response.json(job, { headers: { "cache-control": "no-store" } });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error("[kultunaut-import] status failed:", message);
          return Response.json(
            { status: "failed", reason: "Kultunaut import status unavailable" },
            { status: 500, headers: { "cache-control": "no-store" } },
          );
        }
      },
    },
  },
});
