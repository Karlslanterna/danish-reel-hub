import { expect, test } from "@playwright/test";

test("film index is bounded and exposes self-canonical crawlable pages", async ({ page }) => {
  const response = await page.goto("/film", { waitUntil: "domcontentloaded" });
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByRole("heading", { level: 1, name: "Alle film i biografen" })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://lanterna.dk/film");

  const pageOneLinks = page.locator('section a[href^="/film/"]');
  const pageOneCount = await pageOneLinks.count();
  expect(pageOneCount).toBeGreaterThan(0);
  expect(pageOneCount).toBeLessThanOrEqual(50);
  const firstHref = await pageOneLinks.first().getAttribute("href");

  const next = page.getByRole("link", { name: /Næste/ });
  await expect(next).toHaveAttribute("href", /\/film\?side=2$/);

  const secondResponse = await page.goto("/film?side=2", { waitUntil: "domcontentloaded" });
  expect(secondResponse?.ok()).toBeTruthy();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://lanterna.dk/film?side=2",
  );
  await expect(page.locator('link[rel="prev"]')).toHaveAttribute("href", "https://lanterna.dk/film");
  await expect(page).toHaveTitle(/side 2/u);
  await expect(page.getByText(/Side 2 af/)).toBeVisible();

  const pageTwoLinks = page.locator('section a[href^="/film/"]');
  const pageTwoCount = await pageTwoLinks.count();
  expect(pageTwoCount).toBeGreaterThan(0);
  expect(pageTwoCount).toBeLessThanOrEqual(50);
  expect(await pageTwoLinks.first().getAttribute("href")).not.toBe(firstHref);
});
