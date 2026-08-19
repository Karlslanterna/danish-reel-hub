import { expect, test } from "@playwright/test";

test.describe("Public page-speed boundaries", () => {
  test("homepage renders a bounded mobile batch and progressively reveals the catalogue", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    const cards = page.locator('a[href^="/film/"]');
    const initialCount = await cards.count();
    expect(initialCount).toBeGreaterThan(0);
    expect(initialCount).toBeLessThanOrEqual(40);

    const more = page.getByRole("button", { name: /Vis flere film|Show more films/i });
    if (await more.isVisible()) {
      await more.click();
      await expect.poll(() => cards.count()).toBeGreaterThan(initialCount);
    }

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("public HTML is edge-cacheable while authentication stays private", async ({ request }) => {
    const publicResponse = await request.get("/");
    expect(publicResponse.status()).toBe(200);
    expect(publicResponse.headers()["cache-control"]).toContain("s-maxage=300");

    const authResponse = await request.get("/auth");
    expect(authResponse.status()).toBe(200);
    expect(authResponse.headers()["cache-control"] ?? "").not.toContain("s-maxage");
  });
});
