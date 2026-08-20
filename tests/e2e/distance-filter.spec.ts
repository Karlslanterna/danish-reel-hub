import { expect, test } from "@playwright/test";

const COPENHAGEN = { latitude: 55.6761, longitude: 12.5683 };

const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

for (const viewport of viewports) {
  test(`${viewport.name}: distance filter works on the first interaction and expands by radius`, async ({
    context,
    page,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(COPENHAGEN);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    // The distance control is the one filter that must work before the full
    // national catalogue has hydrated. A swallowed first tap was the production
    // regression this test is designed to catch.
    const distance = page.getByRole("button", { name: /Afstand fra mig|Distance from me/i });
    await expect(distance).toBeVisible();
    await distance.click({ timeout: 3_000 });
    await expect(page.getByRole("button", { name: "2 km", exact: true })).toBeVisible({
      timeout: 3_000,
    });

    const cinemaCounts: number[] = [];
    for (const km of [2, 5, 10] as const) {
      await page.getByRole("button", { name: `${km} km`, exact: true }).click();

      const activeDistance = page.getByRole("button", {
        name: new RegExp(`(?:Inden for|Within) ${km} km`, "i"),
      });
      await expect(activeDistance).toBeVisible();

      // Wait for the complete catalogue before checking effectiveness. The
      // bounded SSR shell is intentionally too small to validate radius counts.
      await expect(activeDistance.locator("xpath=..")).not.toHaveAttribute("aria-busy", "true", {
        timeout: 30_000,
      });

      const cinemaCards = page.locator('#cinemas a[href^="/biograf/"]');
      await expect.poll(() => cinemaCards.count(), { timeout: 10_000 }).toBeGreaterThan(0);
      cinemaCounts.push(await cinemaCards.count());

      if (km !== 10) await activeDistance.click();
    }

    // Copenhagen has cinemas in each successive ring, so a wider radius must
    // add real results rather than merely changing the selected label.
    expect(cinemaCounts[1]).toBeGreaterThan(cinemaCounts[0]);
    expect(cinemaCounts[2]).toBeGreaterThan(cinemaCounts[1]);
  });
}
