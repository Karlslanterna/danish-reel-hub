import { expect, test } from "@playwright/test";

const ATTRIBUTION_FRAGMENT = "#lref-p5xw4utdpfy";
const TARGET_ARRANGEMENTS = [
  "20238093",
  "20238096",
  "20238184",
  "20238194",
  "20238230",
  "20255503",
  "20255560",
  "20255649",
];

test("the deployed outbound attribution sample is present on Dagmar ticket links", async ({
  page,
}) => {
  test.setTimeout(60_000);

  const response = await page.goto(
    "/biograf/nordisk-film-biografer-dagmar-teatret/film/dobbeltspil-2026",
    { waitUntil: "domcontentloaded" },
  );
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByRole("heading", { name: /Dobbeltspil \(2026\)/i }).first()).toBeVisible();

  const selector = TARGET_ARRANGEMENTS.map((id) => `a[href*="ArrNr=${id}"]`).join(", ");
  const targetLinks = page.locator(selector);
  await expect(targetLinks.first()).toBeVisible({ timeout: 45_000 });

  const hrefs = await targetLinks.evaluateAll((links) =>
    links.map((link) => (link as HTMLAnchorElement).href),
  );
  expect(hrefs.length).toBeGreaterThan(0);

  for (const href of hrefs) {
    const url = new URL(href);
    expect(url.hash).toBe(ATTRIBUTION_FRAGMENT);
    expect(TARGET_ARRANGEMENTS).toContain(url.searchParams.get("ArrNr"));
  }
});
