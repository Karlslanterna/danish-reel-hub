/**
 * Minimal TMDb v3 client used by the launch-version enrichment step.
 * Server-only: the API key is read from process.env inside each call and is
 * never returned, logged or surfaced to the browser.
 */

const BASE = "https://api.themoviedb.org/3";
export const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

export type TmdbSearchResult = {
  id: number;
  title: string;
  original_title: string;
  release_date: string | null;
  popularity: number;
  vote_count: number;
};

export type TmdbMovieDetails = {
  id: number;
  title: string;
  original_title: string;
  overview: string | null;
  runtime: number | null;
  release_date: string | null;
  vote_average: number | null;
  poster_path: string | null;
  backdrop_path: string | null;
  genres: Array<{ id: number; name: string }>;
  credits?: {
    cast?: Array<{ name: string; character?: string | null; profile_path?: string | null; order?: number }>;
    crew?: Array<{ name: string; job?: string | null }>;
  };
  videos?: {
    results?: Array<{ key: string; site: string; type: string; official?: boolean; size?: number }>;
  };
};

export class TmdbUnavailableError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "TmdbUnavailableError";
    this.status = status;
  }
}

export function isTmdbConfigured(): boolean {
  return Boolean(process.env.TMDB_API_KEY);
}

async function tmdbGet<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new TmdbUnavailableError("TMDB_API_KEY is not configured", 0);

  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("api_key", key);

  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : "network error";
      await sleep(300 * (attempt + 1));
      continue;
    }

    if (res.ok) return (await res.json()) as T;
    if (res.status === 404) return null;

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "1");
      await sleep(Math.min(5_000, Math.max(1_000, retryAfter * 1000)));
      lastError = "rate limited (HTTP 429)";
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      // Bad or missing key — never retried, never echoed.
      throw new TmdbUnavailableError(`TMDb afviste adgang (HTTP ${res.status})`, res.status);
    }
    if (res.status >= 500) {
      lastError = `HTTP ${res.status}`;
      await sleep(400 * (attempt + 1));
      continue;
    }
    throw new TmdbUnavailableError(`TMDb-fejl (HTTP ${res.status})`, res.status);
  }
  throw new TmdbUnavailableError(`TMDb utilgængelig: ${lastError}`, 0);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function searchMovies(query: string, year?: number): Promise<TmdbSearchResult[]> {
  const params: Record<string, string> = { query, include_adult: "false", language: "da-DK" };
  if (year && year > 1880) params.primary_release_year = String(year);
  const data = await tmdbGet<{ results?: TmdbSearchResult[] }>("/search/movie", params);
  return data?.results ?? [];
}

export async function getMovieDetails(id: number): Promise<TmdbMovieDetails | null> {
  return tmdbGet<TmdbMovieDetails>(`/movie/${id}`, {
    language: "da-DK",
    append_to_response: "credits,videos",
    include_video_language: "da,en,null",
  });
}

export const imageUrl = (path: string | null | undefined, size: string): string | null =>
  path ? `${TMDB_IMAGE_BASE}/${size}${path}` : null;
