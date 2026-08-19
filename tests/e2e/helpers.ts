import { expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

/**
 * Shared helpers for the smoke suite.
 *
 * Smoke fixtures are discovered from the smallest relevant child sitemap.
 * Keeping this discovery dynamic validates whatever is actually live in
 * production without making one test crawl every canonical URL section.
 */

type SitemapSection = "core" | "movies" | "cinemas";

const sitemapPaths: Record<SitemapSection, string> = {
  core: "/sitemap-core.xml",
  movies: "/sitemap-movies.xml",
  cinemas: "/sitemap-cinemas.xml",
};

const sitemapCache = new Map<SitemapSection, string[]>();

const locsFrom = (xml: string): string[] =>
  [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

export async function getSitemapUrls(
  request: APIRequestContext,
  section: SitemapSection,
): Promise<string[]> {
  const cached = sitemapCache.get(section);
  if (cached) return cached;

  const path = sitemapPaths[section];
  const response = await request.get(path);
  if (!response.ok()) {
    throw new Error(`Cannot build smoke fixtures: ${path} returned ${response.status()}`);
  }
  const urls = locsFrom(await response.text());
  sitemapCache.set(section, urls);
  return urls;
}

/** First sitemap path matching a catalog section prefix. */
export async function firstPathFor(
  request: APIRequestContext,
  prefix: "/film/" | "/biograf/",
): Promise<string> {
  const urls = await getSitemapUrls(request, prefix === "/film/" ? "movies" : "cinemas");
  const match = urls.map((u) => new URL(u).pathname).find((p) => p.startsWith(prefix));
  if (!match) {
    throw new Error(`No ${prefix} entry found in child sitemaps — production catalog is empty.`);
  }
  return match;
}

/** City pages are canonical at /<city>, not /by/<city>. */
export async function firstCityPath(request: APIRequestContext): Promise<string> {
  const urls = await getSitemapUrls(request, "core");
  const match = urls
    .map((u) => new URL(u).pathname)
    .find((path) => {
      const parts = path.split("/").filter(Boolean);
      return parts.length === 1 && parts[0] !== "film" && parts[0] !== "biograf";
    });
  if (!match) throw new Error("No canonical city URL found in child sitemaps.");
  return match;
}

/** Navigate and assert a 200 HTML response plus a rendered <h1>. */
export async function expectPageLoads(page: Page, path: string, label: string) {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  if (!response) throw new Error(`${label}: no HTTP response for ${path}`);
  expect(response.status(), `${label}: expected HTTP 200 for ${path}`).toBe(200);
  await expect(page.locator("h1").first(), `${label}: no <h1> rendered on ${path}`).toBeVisible();
  const errors = page.getByText(/Application error|Something went wrong/i);
  expect(await errors.count(), `${label}: error boundary rendered on ${path}`).toBe(0);
}

/** Restore the injected Supabase session so authenticated routes can be hit. */
export async function restoreSupabaseSession(context: BrowserContext, page: Page, baseURL: string) {
  const storageKey = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
  const sessionJson = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
  const cookiesJson = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON;
  if (!storageKey || !sessionJson) return false;

  if (cookiesJson) {
    const cookies = JSON.parse(cookiesJson).map((c: Record<string, unknown>) => ({
      ...c,
      url: baseURL,
    }));
    await context.addCookies(cookies);
  }
  await page.goto("/");
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    [storageKey, sessionJson],
  );
  return true;
}
