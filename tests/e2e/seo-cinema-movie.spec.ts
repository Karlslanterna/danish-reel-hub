import { expect, test } from "@playwright/test";

test("cinema-movie sitemap exposes only live self-canonical landing pages", async ({ request, page }) => {
  const indexResponse = await request.get("/sitemap.xml");
  expect(indexResponse.ok()).toBeTruthy();
  const indexXml = await indexResponse.text();
  expect(indexXml).toContain("/sitemap-cinema-movies.xml");

  const sitemapResponse = await request.get("/sitemap-cinema-movies.xml");
  expect(sitemapResponse.ok()).toBeTruthy();
  const sitemapXml = await sitemapResponse.text();
  const match = sitemapXml.match(
    /<loc>(https:\/\/lanterna\.dk\/biograf\/[^<]+\/film\/[^<]+)<\/loc>/,
  );
  expect(match?.[1]).toBeTruthy();

  const canonicalUrl = match![1];
  const path = new URL(canonicalUrl).pathname;
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response?.ok()).toBeTruthy();

  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", canonicalUrl);
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(" i ");
  await expect(page.getByRole("heading", { level: 2, name: /Spilletider i/i })).toBeVisible();
  await expect(page.getByText(/^\d{2}:\d{2}/).first()).toBeVisible();
});
