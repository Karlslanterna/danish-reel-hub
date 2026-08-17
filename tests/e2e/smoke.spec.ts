import { expect, test } from "@playwright/test";
import { expectPageLoads, firstCityPath, firstPathFor, restoreSupabaseSession } from "./helpers";

const SEARCH_LABEL = "Søg på film, biograf eller by";

async function openSearch(page: import("@playwright/test").Page) {
  const trigger = page.getByRole("button", { name: SEARCH_LABEL }).first();
  await expect(trigger, "Search trigger is missing").toBeVisible();
  await trigger.click();
  const input = page.getByPlaceholder(SEARCH_LABEL).first();
  await expect(input, "Search input did not open").toBeVisible();
  return input;
}

test.describe("Public pages", () => {
  test("1. homepage loads", async ({ page }) => {
    await expectPageLoads(page, "/", "Homepage");
    await expect(
      page.getByRole("button", { name: SEARCH_LABEL }).first(),
      "Homepage: search trigger missing",
    ).toBeVisible();
  });

  test("2. movie page loads", async ({ page, request }) => {
    const path = await firstPathFor(request, "/film/");
    await expectPageLoads(page, path, "Movie page");
  });

  test("3. cinema page loads", async ({ page, request }) => {
    const path = await firstPathFor(request, "/biograf/");
    await expectPageLoads(page, path, "Cinema page");
  });

  test("4. city page loads", async ({ page, request }) => {
    const path = await firstCityPath(request);
    await expectPageLoads(page, path, "City page");
  });

  test("5. search returns results for a known movie", async ({ page, request }) => {
    // The query term is derived from the live movie sitemap, so this test does
    // not depend on one hard-coded title surviving in production.
    const moviePath = await firstPathFor(request, "/film/");
    await page.goto(moviePath, { waitUntil: "domcontentloaded" });
    const title = ((await page.locator("h1").first().textContent()) ?? "").trim();
    const term = title.split(/\s+/)[0].slice(0, 4);
    expect(term.length, `Search: could not derive a query term from "${title}"`).toBeGreaterThan(1);

    await page.goto("/", { waitUntil: "networkidle" });
    const input = await openSearch(page);

    await expect
      .poll(
        async () => {
          await input.fill("");
          await input.pressSequentially(term, { delay: 20 });
          return page.getByRole("option").count();
        },
        {
          message: `Search: no suggestions for known term "${term}" (from "${title}")`,
          timeout: 15_000,
        },
      )
      .toBeGreaterThan(0);

    await expect(
      page.getByRole("option").first(),
      "Search: suggestion list rendered but not visible",
    ).toBeVisible();
  });
});

test.describe("Infrastructure endpoints", () => {
  test("6. /sitemap.xml returns a sitemap index", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status(), "/sitemap.xml must return HTTP 200").toBe(200);
    expect(res.headers()["content-type"] ?? "", "/sitemap.xml must be XML").toMatch(/xml/i);
    const body = await res.text();
    expect(body, "/sitemap.xml must contain a <sitemapindex> root").toContain("<sitemapindex");
    expect(body, "/sitemap.xml must link at least one child sitemap").toContain("<sitemap>");
  });

  test("7. /robots.txt returns 200", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status(), "/robots.txt must return HTTP 200").toBe(200);
    const body = await res.text();
    expect(body, "/robots.txt must contain a User-agent directive").toMatch(/User-agent/i);
  });

  test("8. /api/public/import-health returns valid JSON with 200 or 503", async ({ request }) => {
    const res = await request.get("/api/public/import-health");
    expect([200, 503], `import-health returned unexpected status ${res.status()}`).toContain(
      res.status(),
    );

    let body: unknown;
    const raw = await res.text();
    try {
      body = JSON.parse(raw);
    } catch {
      throw new Error(`import-health did not return valid JSON. Body: ${raw.slice(0, 200)}`);
    }
    const report = body as { status?: string; metrics?: unknown };
    expect(
      ["healthy", "warning", "critical", "unknown"],
      `import-health returned unknown status "${report.status}"`,
    ).toContain(report.status);
    if (res.status() === 503) {
      expect(report.status, "HTTP 503 must map to status=critical").toBe("critical");
    }
  });
});

test.describe("Auth and admin", () => {
  test("9. authentication page loads", async ({ page }) => {
    const response = await page.goto("/auth", { waitUntil: "domcontentloaded" });
    expect(response?.status(), "/auth must return HTTP 200").toBe(200);
    await expect(
      page.getByRole("button", { name: /log ind|opret/i }).first(),
      "/auth: no sign-in control rendered",
    ).toBeVisible();
  });

  test("10a. admin import denies unauthenticated users", async ({ page }) => {
    await page.goto("/admin/import", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/auth/, { timeout: 15_000 }).catch(() => {
      throw new Error(
        `Unauthenticated user was not redirected away from /admin/import (landed on ${page.url()})`,
      );
    });
    expect(page.url(), "Unauthenticated user must land on /auth").toContain("/auth");
  });

  test("10b. authenticated admin can open the import page", async ({ page, context, baseURL }) => {
    const restored = await restoreSupabaseSession(context, page, baseURL!);
    test.skip(
      !restored,
      "No admin session available (LOVABLE_BROWSER_SUPABASE_* not set) — run signed in to cover this flow.",
    );

    await page.goto("/admin/import", { waitUntil: "domcontentloaded" });
    await expect(
      page.locator("h1").first(),
      "Admin import page did not render for an authenticated admin",
    ).toBeVisible();
    expect(page.url(), "Authenticated admin must stay on /admin/import").toContain("/admin/import");
  });
});
