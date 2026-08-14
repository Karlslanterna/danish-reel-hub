import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { CANONICAL_HOST } from "@/lib/canonical";

export const Route = createFileRoute("/sitemap-cinemas.xml")({
  server: {
    handlers: {
      GET: async () => {
        const { loadSitemapData, renderUrlset, xmlResponse } = await import("@/lib/sitemap.server");
        const data = await loadSitemapData(CANONICAL_HOST);
        return xmlResponse(renderUrlset(data.cinemas));
      },
    },
  },
});
