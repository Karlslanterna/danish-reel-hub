import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { CANONICAL_HOST } from "@/lib/canonical";

// This route is registered in routeTree.gen.ts by the TanStack Vite plugin
// during build; CI typechecks once before that generated file is refreshed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute("/sitemap-cinema-movies.xml" as any)({
  server: {
    handlers: {
      GET: async () => {
        const { loadSitemapData, renderUrlset, xmlResponse } = await import("@/lib/sitemap.server");
        const data = await loadSitemapData(CANONICAL_HOST);
        return xmlResponse(renderUrlset(data.cinemaMovies));
      },
    },
  },
});
