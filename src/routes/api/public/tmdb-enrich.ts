import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/public/tmdb-enrich
 *
 * TMDb enrichment is deliberately OUTSIDE the import critical path: an
 * external metadata API must never be able to slow down, fail or block a
 * showtime import. This endpoint drains one enrichment batch and is meant to
 * be called on a schedule (pg_cron) after the daily imports.
 */
export const Route = createFileRoute("/api/public/tmdb-enrich")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const anonKey = process.env.SUPABASE_ANON_KEY;
        const provided = request.headers.get("apikey");
        if (!anonKey || provided !== anonKey) {
          return new Response("Unauthorized", { status: 401 });
        }
        const url = new URL(request.url);
        const limit = Math.min(
          Math.max(Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1),
          100,
        );
        const retrySkipped = url.searchParams.get("retry_skipped") === "1";
        try {
          const { enrichBatch } = await import("@/lib/tmdb/enrich.server");
          const summary = await enrichBatch(limit, { retrySkipped });
          return Response.json({ ok: true, ...summary });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error("tmdb-enrich failed:", message);
          return new Response(`Enrichment failed: ${message}`, { status: 500 });
        }
      },
    },
  },
});
