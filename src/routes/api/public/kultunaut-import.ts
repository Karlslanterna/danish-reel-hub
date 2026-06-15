import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/public/kultunaut-import
 *
 * Accepts a Kultunaut XML payload and creates a background import job.
 * Returns immediately with `{ jobId }`. Processing is driven by polling
 * /api/public/kultunaut-import/process and /api/public/kultunaut-import/status.
 *
 * Auth: requires header `x-kultunaut-secret: <KULTUNAUT_IMPORT_SECRET>`.
 */
export const Route = createFileRoute("/api/public/kultunaut-import")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.KULTUNAUT_IMPORT_SECRET;
        if (!secret) {
          return new Response("Import secret not configured", { status: 500 });
        }
        const provided = request.headers.get("x-kultunaut-secret");
        if (!provided || provided !== secret) {
          return new Response("Unauthorized", { status: 401 });
        }

        const body = await request.text();
        if (!body) return new Response("Empty body", { status: 400 });
        if (body.length > 20_000_000) {
          return new Response("Payload too large (max 20MB)", { status: 413 });
        }

        try {
          const { createImportJob } = await import("@/lib/kultunaut/import.server");
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
