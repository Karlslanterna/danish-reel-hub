import { expect, test } from "@playwright/test";

test.describe("Cinema pages on mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("shows the full programme without horizontal overflow and keeps times ordered", async ({
    page,
  }) => {
    await page.goto("/biograf/empire-bio", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { level: 1, name: "Empire Bio" })).toBeVisible();
    await expect(page.getByText(/film på programmet/i)).toBeVisible();
    expect(await page.getByTestId("cinema-movie-row").count()).toBeGreaterThan(1);

    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      page: document.documentElement.scrollWidth,
    }));
    expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport + 1);

    const firstDate = page.getByTestId("cinema-program-date").first();
    const times = await firstDate
      .getByTestId("cinema-showtime")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-showtime-time") ?? ""));
    const minutes = (time: string) => {
      const [hours, mins] = time.split(":").map(Number);
      return hours * 60 + mins;
    };
    expect(times).toEqual([...times].sort((a, b) => minutes(a) - minutes(b)));
  });

  test("uses the supplied Cinemateket artwork for Børnebiffen", async ({ page }) => {
    await page.goto("/biograf/cinemateket", { waitUntil: "domcontentloaded" });

    await expect(page.getByText(/Børnebiffen/i).first()).toBeVisible();
    const poster = page.locator('img[alt="Cinemateket – Det Danske Filminstitut"]').first();
    await expect(poster).toBeVisible();
    await expect(poster).toHaveAttribute("src", "/posters/bornebiffen-cinemateket.png");
  });
});
