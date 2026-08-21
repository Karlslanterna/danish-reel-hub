import { expect, test, type APIRequestContext, type Browser, type CDPSession, type Page } from "@playwright/test";

const NETWORK = {
  offline: false,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
  latency: 150,
};
const CPU_SLOWDOWN = 4;

async function sitemapPaths(request: APIRequestContext, name: string): Promise<string[]> {
  const response = await request.get(`/sitemap-${name}.xml`);
  expect(response.ok(), `${name} sitemap`).toBeTruthy();
  const xml = await response.text();
  return [...xml.matchAll(/<loc>(https:\/\/lanterna\.dk\/[^<]*)<\/loc>/g)].map(
    (match) => new URL(match[1]!).pathname,
  );
}

async function corePaths(request: APIRequestContext): Promise<string[]> {
  const response = await request.get("/sitemap-core.xml");
  expect(response.ok(), "core sitemap").toBeTruthy();
  const xml = await response.text();
  return [...xml.matchAll(/<loc>(https:\/\/lanterna\.dk(?:\/[^<]*)?)<\/loc>/g)].map(
    (match) => new URL(match[1]!).pathname,
  );
}

async function throttle(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", NETWORK);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
  return cdp;
}

function trackTransfers(cdp: CDPSession) {
  let total = 0;
  let document = 0;
  const documents = new Set<string>();
  cdp.on("Network.responseReceived", (event) => {
    if (event.type === "Document") documents.add(event.requestId);
  });
  cdp.on("Network.loadingFinished", (event) => {
    const bytes = Math.max(0, Number(event.encodedDataLength ?? 0));
    total += bytes;
    if (documents.has(event.requestId)) document += bytes;
  });
  return () => ({ total, document });
}

async function measureRoute(browser: Browser, path: string) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const cdp = await throttle(page);
  const transfer = trackTransfers(cdp);
  const started = Date.now();
  const response = await page.goto(path, { waitUntil: "domcontentloaded", timeout: 60_000 });
  expect(response?.status(), `${path} HTTP status`).toBeLessThan(400);
  await page.locator("h1").first().waitFor({ timeout: 30_000 });
  const h1VisibleMs = Date.now() - started;
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  const paints = await page.evaluate(async () => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0;
    const lcp = await new Promise<number>((resolve) => {
      let last = 0;
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) last = entry.startTime;
        });
        observer.observe({ type: "largest-contentful-paint", buffered: true });
        setTimeout(() => {
          observer.disconnect();
          resolve(last);
        }, 700);
      } catch {
        resolve(0);
      }
    });
    return { ttfb: nav?.responseStart ?? 0, fcp, lcp: lcp || fcp };
  });
  const bytes = transfer();
  await context.close();
  return {
    path,
    h1VisibleMs,
    ttfbMs: Math.round(paints.ttfb),
    fcpMs: Math.round(paints.fcp),
    lcpMs: Math.round(paints.lcp),
    htmlBytes: bytes.document,
    totalBytes: bytes.total,
  };
}

test("audit cold mobile performance across public route families", async ({ browser, request }, testInfo) => {
  test.setTimeout(360_000);
  const [movies, cinemas, cityMovies, cinemaMovies, core] = await Promise.all([
    sitemapPaths(request, "movies"),
    sitemapPaths(request, "cinemas"),
    sitemapPaths(request, "city-movies"),
    sitemapPaths(request, "cinema-movies"),
    corePaths(request),
  ]);

  const reserved = new Set(["/", "/for-boern", "/film", "/biograf", "/babybio", "/seniorbio", "/filmporten", "/biografklub-danmark"]);
  const city = core.find((path) => /^\/[^/]+$/.test(path) && !reserved.has(path));
  const candidates = [
    "/",
    "/for-boern",
    "/babybio",
    "/filmporten",
    "/film",
    "/biograf",
    "/koebenhavn",
    "/film/dobbeltspil-2026",
    "/biograf/empire-bio",
    movies[0],
    cinemas[0],
    city,
    cityMovies[0],
    cinemaMovies[0],
  ].filter((path): path is string => Boolean(path));
  const routes = [...new Set(candidates)];

  const results = [];
  for (const path of routes) results.push(await measureRoute(browser, path));

  const report = {
    profile: { network: NETWORK, cpuSlowdown: CPU_SLOWDOWN, viewport: "390x844", cache: "fresh context per route" },
    routes: results,
  };
  console.log(`[route-performance-audit] ${JSON.stringify(report)}`);
  await testInfo.attach("route-performance-audit.json", {
    body: JSON.stringify(report, null, 2),
    contentType: "application/json",
  });
});
