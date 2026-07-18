import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

const BASE_URL = "https://danish-reel-hub.lovable.app";

type Entry = {
  loc: string;
  lastmod?: string;
  changefreq: "daily" | "weekly";
};

const stripPostcode = (s: string) => s.replace(/^\s*\d{3,4}\s+/u, "").trim();

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const [moviesRes, cinemasRes] = await Promise.all([
          supabaseAdmin.from("movies").select("slug, created_at"),
          supabaseAdmin.from("cinemas").select("slug, city, created_at"),
        ]);

        const entries: Entry[] = [
          { loc: `${BASE_URL}/`, changefreq: "daily", lastmod: new Date().toISOString().slice(0, 10) },
        ];

        for (const m of moviesRes.data ?? []) {
          if (!m.slug) continue;
          entries.push({
            loc: `${BASE_URL}/film/${m.slug}`,
            lastmod: m.created_at ? String(m.created_at).slice(0, 10) : undefined,
            changefreq: "daily",
          });
        }

        const cityLastmod = new Map<string, string>();
        for (const c of cinemasRes.data ?? []) {
          if (!c.slug) continue;
          entries.push({
            loc: `${BASE_URL}/biograf/${c.slug}`,
            lastmod: c.created_at ? String(c.created_at).slice(0, 10) : undefined,
            changefreq: "daily",
          });
          if (c.city) {
            const citySlug = stripPostcode(c.city).toLowerCase();
            if (!citySlug) continue;
            const prev = cityLastmod.get(citySlug);
            const cur = c.created_at ? String(c.created_at).slice(0, 10) : "";
            if (!prev || (cur && cur > prev)) cityLastmod.set(citySlug, cur);
          }
        }

        for (const [citySlug, lastmod] of cityLastmod) {
          entries.push({
            loc: `${BASE_URL}/by/${encodeURIComponent(citySlug)}`,
            lastmod: lastmod || undefined,
            changefreq: "weekly",
          });
        }

        const body = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...entries.map((e) =>
            [
              `  <url>`,
              `    <loc>${e.loc}</loc>`,
              e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null,
              `    <changefreq>${e.changefreq}</changefreq>`,
              `  </url>`,
            ]
              .filter(Boolean)
              .join("\n"),
          ),
          `</urlset>`,
        ].join("\n");

        return new Response(body, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
