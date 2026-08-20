import { expect, test, type CDPSession, type Page } from "@playwright/test";

/**
 * Synthetic mobile performance benchmark.
 *
 * This is deliberately separate from the functional smoke suite: it measures
 * real timings (TTFB / FCP / LCP / navigation) and transferred bytes under a
 * documented throttling profile, instead of asserting DOM or payload
 * boundaries. Run it with `npm run test:performance`.
 *
 * Network profile: "Slow 4G"-like — 1.6 Mbps down, 750 Kbps up, 150 ms RTT.
 * CPU: 4x slowdown, mid-range Android class.
 */
const NETWORK = {
  offline: false,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
  latency: 150,
};
const CPU_SLOWDOWN = 4;

const BUDGETS = {
  ttfbMs: 1500,
  fcpMs: 3000,
  lcpMs: 4000,
  htmlBytes: 350 * 1024,
  totalColdBytes: 1.75 * 1024 * 1024,
  warmFilmNavigationMs: 2000,
};

async function throttle(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", NETWORK);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
  return cdp;
}

/** `transferSize` is 0 for cache hits and some protocols; fall back to the body size. */
const RESOURCE_BYTES_SCRIPT = `
  (() => {
    const entries = performance.getEntriesByType("resource");
    const bytes = (e) => e.transferSize || e.encodedBodySize || 0;
    const nav = performance.getEntriesByType("navigation")[0];
    const html = nav ? (nav.transferSize || nav.encodedBodySize || 0) : 0;
    return {
      html,
      total: html + entries.reduce((sum, e) => sum + bytes(e), 0),
      ttfb: nav ? nav.responseStart : 0,
    };
  })()
`;

async function paintMetrics(page: Page): Promise<{ fcp: number; lcp: number }> {
  return page.evaluate(async () => {
    const fcp =
      performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0;
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
        }, 1000);
      } catch {
        resolve(0);
      }
    });
    return { fcp, lcp: lcp || fcp };
  });
}

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test("cold homepage and warm film navigation stay inside the mobile budgets", async ({
  page,
}, testInfo) => {
  await throttle(page);

  const coldStart = Date.now();
  await page.goto("/", { waitUntil: "load" });
  await page.locator('a[href^="/film/"]').first().waitFor();
  const coldMs = Date.now() - coldStart;

  const paints = await paintMetrics(page);
  const resources = (await page.evaluate(RESOURCE_BYTES_SCRIPT)) as {
    html: number;
    total: number;
    ttfb: number;
  };

  // Warm navigation: the client router is hydrated, so this measures the
  // film-route data path rather than a cold SSR document.
  const firstFilm = page.locator('a[href^="/film/"]').first();
  const warmStart = Date.now();
  await firstFilm.click();
  await page.waitForURL(/\/film\//);
  await page.locator("h1").first().waitFor();
  const warmMs = Date.now() - warmStart;
  const warmBytes = (
    (await page.evaluate(RESOURCE_BYTES_SCRIPT)) as { total: number }
  ).total;

  const report = {
    profile: { network: NETWORK, cpuSlowdown: CPU_SLOWDOWN, viewport: "390x844" },
    cold: {
      loadMs: coldMs,
      ttfbMs: Math.round(resources.ttfb),
      fcpMs: Math.round(paints.fcp),
      lcpMs: Math.round(paints.lcp),
      htmlBytes: resources.html,
      totalBytes: resources.total,
    },
    warmFilmNavigation: { durationMs: warmMs, totalBytes: warmBytes },
    budgets: BUDGETS,
  };
  await testInfo.attach("performance.json", {
    body: JSON.stringify(report, null, 2),
    contentType: "application/json",
  });
  console.log(JSON.stringify(report, null, 2));

  expect(report.cold.ttfbMs, "cold TTFB").toBeLessThanOrEqual(BUDGETS.ttfbMs);
  expect(report.cold.fcpMs, "cold FCP").toBeLessThanOrEqual(BUDGETS.fcpMs);
  expect(report.cold.lcpMs, "cold LCP").toBeLessThanOrEqual(BUDGETS.lcpMs);
  expect(report.cold.htmlBytes, "HTML document transfer").toBeLessThanOrEqual(BUDGETS.htmlBytes);
  expect(report.cold.totalBytes, "total cold transfer").toBeLessThanOrEqual(
    BUDGETS.totalColdBytes,
  );
  expect(warmMs, "warm homepage → film navigation").toBeLessThanOrEqual(
    BUDGETS.warmFilmNavigationMs,
  );
});
