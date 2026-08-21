import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { CANONICAL_HOST } from "@/lib/canonical";

const BASE_URL = CANONICAL_HOST;

/** Sitemap index. Children hold the actual URLs. */
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const { loadSitemapData, xmlResponse } = await import("@/lib/sitemap.server");
        const data = await loadSitemapData(BASE_URL);

        const newest = (arr: { lastmod?: string }[]) =>
          arr.reduce<string | undefined>((a, e) => (!a || (e.lastmod && e.lastmod > a) ? e.lastmod ?? a : a), undefined);

        const children = [
          { loc: `${BASE_URL}/sitemap-core.xml`, lastmod: newest(data.core) },
          { loc: `${BASE_URL}/sitemap-movies.xml`, lastmod: newest(data.movies) },
          { loc: `${BASE_URL}/sitemap-cinemas.xml`, lastmod: newest(data.cinemas) },
          { loc: `${BASE_URL}/sitemap-city-movies.xml`, lastmod: newest(data.cityMovies) },
          { loc: `${BASE_URL}/sitemap-cinema-movies.xml`, lastmod: newest(data.cinemaMovies) },
        ];

        const body = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...children.map((c) =>
            [
              `  <sitemap>`,
              `    <loc>${c.loc}</loc>`,
              c.lastmod ? `    <lastmod>${c.lastmod}</lastmod>` : null,
              `  </sitemap>`,
            ]
              .filter(Boolean)
              .join("\n"),
          ),
          `</sitemapindex>`,
        ].join("\n");

        return xmlResponse(body);
      },
    },
  },
});
