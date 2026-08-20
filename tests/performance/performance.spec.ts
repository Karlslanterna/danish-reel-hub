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
  shellVisibleMs: 5000,
  ttfbMs: 1500,
  fcpMs: 3000,
  lcpMs: 4000,
  htmlBytes: 350 * 1024,
  totalColdBytes: 1.75 * 1024 * 1024,
  warmFilmNavigationMs: 2000,
  warmFilmNavigationBytes: 1.25 * 1024 * 1024,
};

async function throttle(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", NETWORK);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
  return cdp;
}

type TransferSnapshot = { total: number; document: number };

/**
 * ResourceTiming hides cross-origin transfer sizes without Timing-Allow-Origin.
 * CDP's encodedDataLength observes the actual browser network traffic and is
 * therefore suitable for Supabase/API traffic as well as same-origin assets.
 */
function trackTransfers(cdp: CDPSession): () => TransferSnapshot {
  let total = 0;
  let document = 0;
  const documentRequestIds = new Set<string>();

  cdp.on("Network.responseReceived", (event) => {
    if (event.type === "Document") documentRequestIds.add(event.requestId);
  });
  cdp.on("Network.loadingFinished", (event) => {
    const bytes = Math.max(0, Number(event.encodedDataLength ?? 0));
    total += bytes;
    if (documentRequestIds.has(event.requestId)) document += bytes;
  });

  return () => ({ total, document });
}

async function navigationTtfb(page: Page): Promise<number> {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return nav?.responseStart ?? 0;
  });
}

async function paintMetrics(page: Page): Promise<{ fcp: number; lcp: number }> {
  return page.evaluate(async () => {
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
  const cdp = await throttle(page);
  const transferSnapshot = trackTransfers(cdp);

  const coldStart = Date.now();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('a[href^="/film/"]').first().waitFor();
  const shellVisibleMs = Date.now() - coldStart;

  // Let the deferred full catalogue settle before taking the complete cold
  // session byte total and before measuring a warm client-side film route.
  await page.waitForLoadState("networkidle");
  const paints = await paintMetrics(page);
  const ttfb = await navigationTtfb(page);
  const coldTransfer = transferSnapshot();

  const firstFilm = page.locator('a[href^="/film/"]').first();
  const beforeWarm = transferSnapshot();
  const warmStart = Date.now();
  await firstFilm.click();
  await page.waitForURL(/\/film\//);
  await page.locator("h1").first().waitFor();
  await page.waitForLoadState("networkidle");
  const warmMs = Date.now() - warmStart;
  const afterWarm = transferSnapshot();
  const warmBytes = Math.max(0, afterWarm.total - beforeWarm.total);

  const report = {
    profile: { network: NETWORK, cpuSlowdown: CPU_SLOWDOWN, viewport: "390x844" },
    cold: {
      shellVisibleMs,
      ttfbMs: Math.round(ttfb),
      fcpMs: Math.round(paints.fcp),
      lcpMs: Math.round(paints.lcp),
      htmlBytes: coldTransfer.document,
      totalBytes: coldTransfer.total,
    },
    warmFilmNavigation: { durationMs: warmMs, transferredBytes: warmBytes },
    budgets: BUDGETS,
  };
  const metrics = JSON.stringify(report, null, 2);
  await testInfo.attach("performance.json", {
    body: metrics,
    contentType: "application/json",
  });
  console.log(`[performance-metrics] ${JSON.stringify(report)}`);

  expect(report.cold.shellVisibleMs, "cold shell visible").toBeLessThanOrEqual(
    BUDGETS.shellVisibleMs,
  );
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
  expect(warmBytes, "warm homepage → film transferred bytes").toBeLessThanOrEqual(
    BUDGETS.warmFilmNavigationBytes,
  );
});
