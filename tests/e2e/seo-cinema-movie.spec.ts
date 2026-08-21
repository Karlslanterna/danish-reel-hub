import { expect, test, type APIRequestContext } from "@playwright/test";

async function firstCinemaMoviePath(request: APIRequestContext) {
  const sitemapResponse = await request.get("/sitemap-cinema-movies.xml");
  expect(sitemapResponse.ok()).toBeTruthy();
  const sitemapXml = await sitemapResponse.text();
  const match = sitemapXml.match(
    /<loc>(https:\/\/lanterna\.dk\/biograf\/[^<]+\/film\/[^<]+)<\/loc>/,
  );
  expect(match?.[1]).toBeTruthy();
  return new URL(match![1]).pathname;
}

test("cinema-movie sitemap exposes only live self-canonical landing pages", async ({ request, page }) => {
  const indexResponse = await request.get("/sitemap.xml");
  expect(indexResponse.ok()).toBeTruthy();
  const indexXml = await indexResponse.text();
  expect(indexXml).toContain("/sitemap-cinema-movies.xml");

  const path = await firstCinemaMoviePath(request);
  const canonicalUrl = `https://lanterna.dk${path}`;
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response?.ok()).toBeTruthy();

  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", canonicalUrl);
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(" i ");
  await expect(page.getByRole("heading", { level: 2, name: /Spilletider i/i })).toBeVisible();
  await expect(page.getByText(/^\d{2}:\d{2}/).first()).toBeVisible();
});

test("movie and cinema pages link into the live cinema-movie layer", async ({ request, page }) => {
  const path = await firstCinemaMoviePath(request);
  const parts = path.split("/").filter(Boolean);
  const cinemaSlug = parts[1];
  const movieSlug = parts[3];
  expect(cinemaSlug).toBeTruthy();
  expect(movieSlug).toBeTruthy();

  // Every cinema programme row is rendered, so the specific sitemap pair must
  // be linked from its cinema page.
  await page.goto(`/biograf/${cinemaSlug}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(`a[href="${path}"]`).first()).toBeVisible({ timeout: 20_000 });

  // National movie pages intentionally render only the first 24 cinemas until
  // the visitor asks for more. Require that the visible programme injects the
  // movie into the combined SEO layer, rather than requiring an arbitrary
  // sitemap cinema to fall inside that first UI batch.
  await page.goto(`/film/${movieSlug}`, { waitUntil: "domcontentloaded" });
  const movieLayerLink = page.locator(
    `a[href^="/biograf/"][href$="/film/${movieSlug}"]`,
  ).first();
  await expect(movieLayerLink).toBeVisible({ timeout: 30_000 });
});
