import { expect, test } from "@playwright/test";

const FILTERED_LANDING_HTML_BUDGET = 160 * 1024;

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

    const sentinel = page.getByTestId("movie-load-sentinel");
    await expect(sentinel).toBeAttached();
    await sentinel.scrollIntoViewIfNeeded();
    await expect
      .poll(() => cards.count(), { timeout: 30_000 })
      .toBeGreaterThan(initialCount);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("filtered SEO landings keep the first HTML document bounded", async ({ request }) => {
    for (const path of [
      "/for-boern",
      "/babybio",
      "/seniorbio",
      "/filmporten",
      "/biografklub-danmark",
    ]) {
      const response = await request.get(path);
      expect(response.status(), `${path} HTTP status`).toBe(200);
      const body = await response.body();
      expect(
        body.byteLength,
        `${path} must not serialize national showtime history into first-paint HTML`,
      ).toBeLessThanOrEqual(FILTERED_LANDING_HTML_BUDGET);
    }
  });

  test("the hosting cache policy is explicit while authentication stays private", async ({
    request,
  }, testInfo) => {
    const publicResponse = await request.get("/");
    expect(publicResponse.status()).toBe(200);
    const publicHeaders = publicResponse.headers();
    const browserCachePolicy = publicHeaders["cache-control"] ?? "";
    const cdnCachePolicy = publicHeaders["cdn-cache-control"] ?? "";
    const sharedCacheEnabled =
      /s-maxage=300/.test(browserCachePolicy) || /max-age=300/.test(cdnCachePolicy);
    const hostForcesRevalidation = /no-cache|must-revalidate/.test(browserCachePolicy);
    expect(
      sharedCacheEnabled || hostForcesRevalidation,
      "Public HTML must expose either the app's shared-cache policy or Lovable's explicit revalidation policy",
    ).toBe(true);
    if (!sharedCacheEnabled && hostForcesRevalidation) {
      testInfo.annotations.push({
        type: "infrastructure",
        description:
          "Lovable managed hosting strips the app's CDN cache directive and forces revalidation.",
      });
    }

    const authResponse = await request.get("/auth");
    expect(authResponse.status()).toBe(200);
    const authHeaders = authResponse.headers();
    expect(authHeaders["cache-control"] ?? "").not.toContain("s-maxage");
    expect(authHeaders["cdn-cache-control"] ?? "").not.toContain("max-age");
  });
});
