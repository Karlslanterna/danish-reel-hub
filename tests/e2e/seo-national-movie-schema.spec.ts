import { expect, test } from "@playwright/test";

function sitemapPaths(xml: string): string[] {
  return [...xml.matchAll(/<loc>(https:\/\/lanterna\.dk\/film\/[^<]+)<\/loc>/g)].map(
    (match) => new URL(match[1]!).pathname,
  );
}

test("national movie page publishes a bounded representative ScreeningEvent graph", async ({
  page,
  request,
}) => {
  const sitemap = await request.get("/sitemap-movies.xml");
  expect(sitemap.ok()).toBeTruthy();
  const paths = sitemapPaths(await sitemap.text());
  expect(paths.length).toBeGreaterThan(0);

  // Try a few current sitemap movies because an individual title may have lost
  // its last showtime between sitemap generation and this live smoke request.
  let found = false;
  for (const path of paths.slice(0, 8)) {
    const response = await page.goto(path, { waitUntil: "domcontentloaded" });
    if (!response?.ok()) continue;
    const scripts = await page.locator('script[type="application/ld+json"]').allTextContents();
    const events = scripts.flatMap((text) => {
      try {
        const parsed = JSON.parse(text) as { "@graph"?: Array<{ "@type"?: string }> };
        return (parsed["@graph"] ?? []).filter((item) => item["@type"] === "ScreeningEvent");
      } catch {
        return [];
      }
    });
    if (events.length === 0) continue;
    expect(events.length).toBeLessThanOrEqual(3);
    found = true;
    break;
  }

  expect(found, "At least one current national movie page should expose representative ScreeningEvent JSON-LD").toBe(true);
});
