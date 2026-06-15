import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/public/kultunaut-import
 *
 * Accepts a Kultunaut XML payload and upserts movies, cinemas, and showtimes
 * into Lovable Cloud.
 *
 * Auth: requires header `x-kultunaut-secret: <KULTUNAUT_IMPORT_SECRET>`.
 * Content: raw XML body (Content-Type: application/xml or text/xml).
 * Limit:   20 MB per request to protect the Worker runtime.
 *
 * Example:
 *   curl -X POST https://<host>/api/public/kultunaut-import \
 *        -H 'x-kultunaut-secret: ...' \
 *        -H 'Content-Type: application/xml' \
 *        --data-binary @feed.xml
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
        if (!body) {
          return new Response("Empty body", { status: 400 });
        }
        if (body.length > 20_000_000) {
          return new Response("Payload too large (max 20MB)", { status: 413 });
        }

        try {
          const { importKultunautXml } = await import(
            "@/lib/kultunaut/import.server"
          );
          const result = await importKultunautXml(body);
          return Response.json(result, {
            status: result.errors.length > 0 ? 207 : 200,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error("kultunaut-import failed:", message);
          return new Response(`Import failed: ${message}`, { status: 500 });
        }
      },
    },
  },
});
