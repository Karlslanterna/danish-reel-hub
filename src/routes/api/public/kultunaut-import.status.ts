import { createFileRoute } from "@tanstack/react-router";

/**
 * Retired compatibility route.
 *
 * Import status is now read through authenticated admin server functions.
 * The old public status endpoint no longer exposes job data.
 */
export const Route = createFileRoute("/api/public/kultunaut-import/status")({
  server: {
    handlers: {
      GET: async () =>
        new Response("Gone", {
          status: 410,
          headers: { "cache-control": "no-store" },
        }),
    },
  },
});
