import { createFileRoute } from "@tanstack/react-router";

/**
 * Retired compatibility route.
 *
 * Kultunaut jobs are now drained by the scheduler or by authenticated admin
 * server functions. Keeping a tiny 410 response avoids leaving the old public
 * processing implementation reachable while the generated route tree still
 * references this path.
 */
export const Route = createFileRoute("/api/public/kultunaut-import/process")({
  server: {
    handlers: {
      POST: async () =>
        new Response("Gone", {
          status: 410,
          headers: { "cache-control": "no-store" },
        }),
    },
  },
});
