// Sitemap data layer.
//
// Every entry is derived from real, upcoming canonical screenings: a URL only
// enters a sitemap when it has at least one user-visible film screening inside
// the public window. Compatibility `showtimes` must never drive Google URLs.
// `lastmod` comes from the newest canonical screening backing that URL.

import { citySlug } from "./city-slug";
import { windowStart, windowEnd } from "./date-window";
import {
  isPublicMovieTitle,
  publicMovieDisplayTitle,
  resolvePublicMovieYear,
} from "./public-movie";
import { consolidatePublicMovies } from "./public-catalog";
import type { Movie } from "./cinema-data";

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
};

async function loadUpcomingScreenings(): Promise<ScreeningRow[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const out: ScreeningRow[] = [];
  const pageSize = 1000;
  const now = new Date().toISOString();
  for (let page = 0; ; page++) {
    const { data, error } = await supabaseAdmin
      .from("screenings")
      .select("movie_id, cinema_id, updated_at")
      .gte("starts_at", now)
      .gte("local_date", windowStart())
      .lte("local_date", windowEnd())
      .order("starts_at", { ascending: true })
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as ScreeningRow[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

export async function loadSitemapData(baseUrl: string): Promise<SitemapData> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const [moviesRes, cinemasRes, screenings] = await Promise.all([
    supabaseAdmin
      .from("movies")
      .select("id, slug, title, year, tmdb_id, source, release_date"),
    supabaseAdmin.from("cinemas").select("id, slug, city"),
    loadUpcomingScreenings(),
  ]);

  const publicMovieRows = (moviesRes.data ?? []).filter(
    (movie) => movie.slug && isPublicMovieTitle(movie.title),
  );
  const publicMovies = publicMovieRows.map((movie): Movie => ({
    id: movie.id,
    slug: movie.slug,
    title: publicMovieDisplayTitle(movie.title),
    runtime: 0,
    genre: [],
    year: resolvePublicMovieYear({
      id: movie.id,
      source: movie.source,
      year: movie.year,
      releaseDate: movie.release_date,
      tmdbId: movie.tmdb_id,
    }),
    director: "",
    rating: "",
    synopsis: "",
    poster: {},
    tmdbId: movie.tmdb_id ?? null,
  }));
  const consolidated = consolidatePublicMovies(publicMovies);
  const canonicalSlug = new Map(consolidated.movies.map((movie) => [movie.id, movie.slug]));
  const movieSlug = new Map<string, string>();
  for (const movie of publicMovieRows) {
    const canonicalId = consolidated.movieIdMap.get(movie.id);
    const slug = canonicalId ? canonicalSlug.get(canonicalId) : undefined;
    if (slug) movieSlug.set(movie.id, slug);
  }

  const cinemaInfo = new Map<string, { slug: string; city: string }>();
  for (const c of cinemasRes.data ?? []) {
    if (!c.slug) continue;
    cinemaInfo.set(c.id, { slug: c.slug, city: c.city ?? "" });
  }

  const movieMod = new Map<string, string | undefined>();
  const cinemaMod = new Map<string, string | undefined>();
  const cityMod = new Map<string, string | undefined>();
  const cityMovieMod = new Map<string, string | undefined>();
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
    { loc: `${baseUrl}/film`, lastmod: siteMod, changefreq: "daily", priority: "0.8" },
    { loc: `${baseUrl}/biograf`, lastmod: siteMod, changefreq: "daily", priority: "0.8" },
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
