import { createFileRoute } from "@tanstack/react-router";

const EVENT_TYPES = new Set(["page_view", "filter_change", "zero_results", "ticket_click"]);
const ITEM_TYPES = new Set(["movie", "cinema"]);

const textField = (value: unknown, max: number) =>
  typeof value === "string" && value.length > 0 ? value.slice(0, max) : null;

type AnalyticsDb = {
  from: (table: "analytics_events") => {
    insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
  };
};

export const Route = createFileRoute("/api/public/analytics")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const headers = {
          "cache-control": "no-store",
          "x-robots-tag": "noindex",
        };
        const requestUrl = new URL(request.url);
        if (request.headers.get("origin") !== requestUrl.origin) {
          return new Response(null, { status: 403, headers });
        }
        const contentLength = Number(request.headers.get("content-length") ?? "0");
        if (contentLength > 4096) return new Response(null, { status: 413, headers });

        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return new Response(null, { status: 400, headers });
        }

        const eventType = textField(body.eventType, 32);
        const path = textField(body.path, 300);
        const itemType = textField(body.itemType, 32);
        if (!eventType || !EVENT_TYPES.has(eventType) || !path || !path.startsWith("/")) {
          return new Response(null, { status: 400, headers });
        }
        if (itemType && !ITEM_TYPES.has(itemType)) {
          return new Response(null, { status: 400, headers });
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await (supabaseAdmin as unknown as AnalyticsDb)
            .from("analytics_events")
            .insert({
              event_type: eventType,
              path,
              item_type: itemType,
              item_id: textField(body.itemId, 160),
              filter_name: textField(body.filterName, 80),
              filter_value: textField(body.filterValue, 160),
              is_active: typeof body.isActive === "boolean" ? body.isActive : null,
            });
          if (error) throw error;
          return new Response(null, { status: 204, headers });
        } catch (error) {
          console.error(
            "[analytics] event insert failed:",
            error instanceof Error ? error.message : "Unknown error",
          );
          return new Response(null, { status: 500, headers });
        }
      },
    },
  },
});
