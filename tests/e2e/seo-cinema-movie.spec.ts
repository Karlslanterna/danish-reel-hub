import { expect, test } from "@playwright/test";

async function firstCinemaMoviePath(request: Parameters<typeof test>[0] extends never ? never : any) {
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

  await page.goto(`/biograf/${cinemaSlug}`, { waitUntil: "domcontentloaded" });
  const cinemaLink = page.locator(`a[href="${path}"]`).first();
  await expect(cinemaLink).toBeVisible({ timeout: 20_000 });

  await page.goto(`/film/${movieSlug}`, { waitUntil: "domcontentloaded" });
  const movieLink = page.locator(`a[href="${path}"]`).first();
  await expect(movieLink).toBeVisible({ timeout: 30_000 });
});
