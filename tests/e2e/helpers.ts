import { expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

/**
 * Shared helpers for the smoke suite.
 *
 * Design goals:
 *  - deterministic: URLs under test are discovered from /sitemap.xml at run
 *    time instead of hard-coding slugs that may disappear from the catalog.
 *  - fast: sitemap is fetched once per worker and cached.
 *  - clear failures: every helper throws a message that names the URL and the
 *    expectation that failed.
 */

let sitemapCache: string[] | null = null;

export async function getSitemapUrls(request: APIRequestContext): Promise<string[]> {
  if (sitemapCache) return sitemapCache;
  const res = await request.get("/sitemap.xml");
  if (!res.ok()) {
    throw new Error(`Cannot build smoke fixtures: /sitemap.xml returned ${res.status()}`);
  }
  const xml = await res.text();
  sitemapCache = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  return sitemapCache;
}

/** First sitemap path matching a section prefix, e.g. "/film/". */
export async function firstPathFor(
  request: APIRequestContext,
  prefix: "/film/" | "/biograf/" | "/by/",
): Promise<string> {
  const urls = await getSitemapUrls(request);
  const match = urls.map((u) => new URL(u).pathname).find((p) => p.startsWith(prefix));
  if (!match) {
    throw new Error(
      `No ${prefix} entry found in /sitemap.xml — the catalog is empty, so this smoke test cannot run.`,
    );
  }
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
