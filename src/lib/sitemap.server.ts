// Sitemap data layer.
//
// Every entry is derived from real, upcoming canonical screenings: a URL only
// enters a sitemap when it has at least one user-visible film screening inside
// the public window. Compatibility `showtimes` must never drive Google URLs.
// `lastmod` comes from the newest canonical screening backing that URL.

import { citySlug } from "./city-slug";
import { windowStart, windowEnd } from "./date-window";
import { fetchMovies, type Movie } from "./cinema-data";
import { consolidatePublicCinemas } from "./cinema-catalog";
import { SPECIAL_EVENTS } from "./special-events";

export type SitemapEntry = {
  loc: string;
  lastmod?: string;
  changefreq: "daily" | "weekly";
  priority?: string;
};

export type SitemapData = {
  core: SitemapEntry[];
  movies: SitemapEntry[];
  cinemas: SitemapEntry[];
  cityMovies: SitemapEntry[];
};

const day = (v: unknown) => (v ? String(v).slice(0, 10) : undefined);

const newer = (a: string | undefined, b: string | undefined) => (!a ? b : !b ? a : a > b ? a : b);

type ScreeningRow = {
  movie_id: string;
  cinema_id: string;
  updated_at: string | null;
  events: string[] | null;
};

async function loadUpcomingScreenings(): Promise<ScreeningRow[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const out: ScreeningRow[] = [];
  const pageSize = 1000;
  const now = new Date().toISOString();
  for (let page = 0; ; page++) {
    const { data, error } = await supabaseAdmin
      .from("screenings")
      .select("movie_id, cinema_id, updated_at, events")
      .gte("starts_at", now)
      .gte("local_date", windowStart())
      .lte("local_date", windowEnd())
      .order("starts_at", { ascending: true })
      .order("id", { ascending: true })
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as ScreeningRow[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

/** Use the exact canonical slugs selected by the public catalog loader. */
export function canonicalMovieSlugMap(movies: Movie[]): Map<string, string> {
  const slugs = new Map<string, string>();
  for (const movie of movies) {
    for (const sourceId of movie.sourceIds ?? [movie.id]) slugs.set(sourceId, movie.slug);
  }
  return slugs;
}

export async function loadSitemapData(baseUrl: string): Promise<SitemapData> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const [publicMovies, cinemasRes, screenings] = await Promise.all([
    fetchMovies(),
    supabaseAdmin.from("cinemas").select("id, slug, city"),
    loadUpcomingScreenings(),
  ]);

  const movieSlug = canonicalMovieSlugMap(publicMovies);

  const cinemaInfo = new Map<string, { slug: string; city: string }>();
  if (cinemasRes.error) throw cinemasRes.error;
  const publicCinemas = consolidatePublicCinemas(cinemasRes.data ?? []);
  for (const c of publicCinemas) {
    if (!c.slug) continue;
    for (const sourceId of c.sourceIds) {
      cinemaInfo.set(sourceId, { slug: c.slug, city: c.city ?? "" });
    }
  }

  const movieMod = new Map<string, string | undefined>();
  const cinemaMod = new Map<string, string | undefined>();
  const cityMod = new Map<string, string | undefined>();
  const cityMovieMod = new Map<string, string | undefined>();
  const specialMod = new Map<string, string | undefined>();
  let siteMod: string | undefined;

  for (const s of screenings) {
    const mSlug = movieSlug.get(s.movie_id);
    // A non-film/event shell is intentionally absent from public film pages,
    // filters and sitemaps. It must not make a cinema/city look active to Google
    // by itself either.
    if (!mSlug) continue;

    const mod = day(s.updated_at);
    siteMod = newer(siteMod, mod);

    const cinema = cinemaInfo.get(s.cinema_id);
    movieMod.set(mSlug, newer(movieMod.get(mSlug), mod));
    for (const event of SPECIAL_EVENTS) {
      if ((s.events ?? []).includes(event.tag)) {
        specialMod.set(event.tag, newer(specialMod.get(event.tag), mod));
      }
    }
    if (cinema) cinemaMod.set(cinema.slug, newer(cinemaMod.get(cinema.slug), mod));
    if (!cinema?.city) continue;
    const city = citySlug(cinema.city);
    if (!city) continue;
    cityMod.set(city, newer(cityMod.get(city), mod));
    const key = `${city}/${mSlug}`;
    cityMovieMod.set(key, newer(cityMovieMod.get(key), mod));
  }

  const core: SitemapEntry[] = [
    { loc: `${baseUrl}/`, lastmod: siteMod, changefreq: "daily", priority: "1.0" },
    { loc: `${baseUrl}/for-boern`, lastmod: siteMod, changefreq: "daily", priority: "0.9" },
    { loc: `${baseUrl}/film`, lastmod: siteMod, changefreq: "daily", priority: "0.8" },
    { loc: `${baseUrl}/biograf`, lastmod: siteMod, changefreq: "daily", priority: "0.8" },
    ...SPECIAL_EVENTS.filter((event) => specialMod.has(event.tag)).map((event) => ({
      loc: `${baseUrl}${event.path}`,
      lastmod: specialMod.get(event.tag),
      changefreq: "daily" as const,
      priority: "0.8",
    })),
    ...[...cityMod.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([slug, lastmod]) => ({
        loc: `${baseUrl}/${slug}`,
        lastmod,
        changefreq: "daily" as const,
        priority: "0.9",
      })),
  ];

  const movies: SitemapEntry[] = [...movieMod.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slug, lastmod]) => ({
      loc: `${baseUrl}/film/${slug}`,
      lastmod,
      changefreq: "daily" as const,
      priority: "0.8",
    }));

  const cinemas: SitemapEntry[] = [...cinemaMod.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slug, lastmod]) => ({
      loc: `${baseUrl}/biograf/${slug}`,
      lastmod,
      changefreq: "daily" as const,
      priority: "0.7",
    }));

  const cityMovies: SitemapEntry[] = [...cityMovieMod.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, lastmod]) => ({
      loc: `${baseUrl}/${key.split("/")[0]}/film/${key.split("/").slice(1).join("/")}`,
      lastmod,
      changefreq: "daily" as const,
      priority: "0.7",
    }));

  return { core, movies, cinemas, cityMovies };
}

export function renderUrlset(entries: SitemapEntry[]): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...entries.map((e) =>
      [
        `  <url>`,
        `    <loc>${e.loc}</loc>`,
        e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null,
        `    <changefreq>${e.changefreq}</changefreq>`,
        e.priority ? `    <priority>${e.priority}</priority>` : null,
        `  </url>`,
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    `</urlset>`,
  ].join("\n");
}

export function xmlResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
