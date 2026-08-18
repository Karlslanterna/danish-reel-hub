import { expect, test, type Page } from "@playwright/test";

async function openFilterGroup(page: Page, group: "Arrangement" | "Visningstype" | "Sprog" | "Genre") {
  await page.getByRole("button", { name: "Flere filtre" }).click();
  await page.getByRole("button", { name: group, exact: true }).click();
}

test.describe("Filter conformance", () => {
  test("special filter survives film and cinema navigation and toggles off in one press", async ({ page }) => {
    await page.goto("/babybio", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 1, name: /Babybio/i })).toBeVisible();

    const movieLink = page.locator('a[href^="/film/"]').first();
    await expect(movieLink).toBeVisible();
    await movieLink.click();
    await expect(page.getByRole("heading", { level: 2, name: /Spilletider/i })).toBeVisible();

    await openFilterGroup(page, "Arrangement");
    const babybio = page.getByRole("button", { name: "Babybio", exact: true });
    await expect(babybio).toHaveClass(/bg-primary/);

    // One press on the selected option removes it; no separate close icon is required.
    await babybio.click();
    await openFilterGroup(page, "Arrangement");
    await expect(page.getByRole("button", { name: "Babybio", exact: true })).not.toHaveClass(
      /bg-primary/,
    );
  });

  test("child filter survives navigation to a film", async ({ page }) => {
    await page.goto("/for-boern", { waitUntil: "networkidle" });
    const childButton = page.getByRole("button", { name: "For børn", exact: true });
    await expect(childButton).toHaveAttribute("aria-pressed", "true");
    await page.locator('a[href^="/film/"]').first().click();
    await expect(page.getByRole("button", { name: "For børn", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("cinema time filter removes individual non-matching time buttons", async ({ page }) => {
    await page.goto("/biograf/empire-bio", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Tidspunkt" }).click();
    const afternoon = page.getByRole("button", { name: "Eftermiddag", exact: true });
    test.skip(!(await afternoon.count()), "Empire has no current afternoon screening");
    await afternoon.click();
    const times = await page
      .getByTestId("cinema-showtime")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-showtime-time") ?? ""));
    expect(times.length).toBeGreaterThan(0);
    for (const time of times) {
      const [hour, minute] = time.split(":").map(Number);
      const value = hour * 60 + minute;
      expect(value, `${time} is outside the afternoon interval`).toBeGreaterThanOrEqual(12 * 60);
      expect(value, `${time} is outside the afternoon interval`).toBeLessThan(17 * 60);
    }
  });

  test("city child landing pages are canonical and responsive", async ({ page, request }) => {
    const sitemap = await request.get("/sitemap-core.xml");
    const xml = await sitemap.text();
    const match = xml.match(/<loc>https:\/\/lanterna\.dk\/([^<]+)\/for-boern<\/loc>/);
    test.skip(!match, "No city currently has at least two child movies");
    const path = `/${match![1]}/for-boern`;
    await page.setViewportSize({ width: 390, height: 844 });
    const response = await page.goto(path, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `https://lanterna.dk${path}`,
    );
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      page: document.documentElement.scrollWidth,
    }));
    expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport + 1);
  });
});
