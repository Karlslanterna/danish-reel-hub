import { expect, test } from "@playwright/test";

const CANARY_FRAGMENT = "#lref-v7m2q9k4dx";
const CANARY_ACTIVE_FROM = "2026-08-21";
const CANARY_ACTIVE_THROUGH = "2026-09-07";

const copenhagenDate = (now: Date = new Date()): string => {
  const parts: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Copenhagen",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)) {
    parts[part.type] = part.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
};

test("production exposes the short-lived outbound canary on current Dagmar links", async ({
  page,
}) => {
  test.skip(!process.env.SMOKE_BASE_URL, "Production-only canary verification");
  const today = copenhagenDate();
  test.skip(
    today < CANARY_ACTIVE_FROM || today > CANARY_ACTIVE_THROUGH,
    "The short-lived canary period is not active",
  );

  await page.goto("/biograf/nordisk-film-biografer-dagmar-teatret", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Nordisk Film Biografer - Dagmar Teatret",
    }),
  ).toBeVisible();

  const providerLinks = page.locator(
    'a[href*="kultunaut.dk/perl/billet/type-nynaut"]',
  );
  await expect.poll(() => providerLinks.count(), { timeout: 20_000 }).toBeGreaterThan(0);

  const hrefs = await providerLinks.evaluateAll((nodes) =>
    nodes
      .map((node) => node.getAttribute("href"))
      .filter((href): href is string => Boolean(href)),
  );
  const marked = hrefs.filter((href) => new URL(href).hash === CANARY_FRAGMENT);
  const unmarked = hrefs.filter((href) => new URL(href).hash === "");

  expect(marked.length).toBeGreaterThan(0);
  expect(unmarked.length).toBeGreaterThan(0);
  expect(
    marked.every((href) => new URL(href).searchParams.get("ArrNr")?.endsWith("3")),
  ).toBe(true);
});
