import { expect, test, type CDPSession, type Page } from "@playwright/test";

const NETWORK = {
  offline: false,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
  latency: 150,
};
const CPU_SLOWDOWN = 4;

type Budget = {
  h1Ms: number;
  ttfbMs: number;
  fcpMs: number;
  lcpMs: number;
  totalBytes: number;
};

type RouteSpec = { path: string; budget: Budget };
type Result = {
  path: string;
  h1Ms: number;
  ttfbMs: number;
  fcpMs: number;
  lcpMs: number;
  totalBytes: number;
};

const ROUTES: RouteSpec[] = [
  {
    path: "/for-boern",
    budget: { h1Ms: 5_000, ttfbMs: 3_000, fcpMs: 4_000, lcpMs: 5_000, totalBytes: 1_500_000 },
  },
  {
    path: "/babybio",
    budget: { h1Ms: 5_000, ttfbMs: 3_000, fcpMs: 4_000, lcpMs: 5_000, totalBytes: 1_500_000 },
  },
  {
    path: "/film",
    budget: { h1Ms: 4_000, ttfbMs: 3_000, fcpMs: 3_000, lcpMs: 4_500, totalBytes: 2_000_000 },
  },
];

async function throttle(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", NETWORK);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
  return cdp;
}

function trackTransfers(cdp: CDPSession) {
  let total = 0;
  cdp.on("Network.loadingFinished", (event) => {
    total += Math.max(0, Number(event.encodedDataLength ?? 0));
  });
  return () => total;
}

async function measure(page: Page, path: string): Promise<Result> {
  const cdp = await throttle(page);
  const transfer = trackTransfers(cdp);
  const started = Date.now();
  const response = await page.goto(path, { waitUntil: "domcontentloaded", timeout: 60_000 });
  expect(response?.status(), `${path} HTTP status`).toBeLessThan(400);
  await page.locator("h1").first().waitFor({ timeout: 30_000 });
  const h1Ms = Date.now() - started;
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
  return {
    path,
    h1Ms,
    ttfbMs: Math.round(paints.ttfb),
    fcpMs: Math.round(paints.fcp),
    lcpMs: Math.round(paints.lcp),
    totalBytes: transfer(),
  };
}

function budgetFailures(route: RouteSpec, result: Result): string[] {
  const failures: string[] = [];
  const checks: Array<[keyof Omit<Result, "path">, keyof Budget]> = [
    ["h1Ms", "h1Ms"],
    ["ttfbMs", "ttfbMs"],
    ["fcpMs", "fcpMs"],
    ["lcpMs", "lcpMs"],
    ["totalBytes", "totalBytes"],
  ];
  for (const [resultKey, budgetKey] of checks) {
    if (result[resultKey] > route.budget[budgetKey]) {
      failures.push(`${route.path} ${resultKey}: ${result[resultKey]} > ${route.budget[budgetKey]}`);
    }
  }
  return failures;
}

test("key public landing routes stay inside mobile budgets", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const results: Result[] = [];

  // Measure every route before asserting. A slow first route must never hide
  // diagnostics for the remaining pages.
  for (const route of ROUTES) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    results.push(await measure(page, route.path));
    await context.close();
  }

  const report = {
    profile: { network: NETWORK, cpuSlowdown: CPU_SLOWDOWN },
    routes: results,
  };
  console.log(`[key-route-performance] ${JSON.stringify(results)}`);
  await testInfo.attach("key-route-performance.json", {
    body: JSON.stringify(report, null, 2),
    contentType: "application/json",
  });

  const failures = ROUTES.flatMap((route) => {
    const result = results.find((item) => item.path === route.path)!;
    return budgetFailures(route, result);
  });
  expect(failures, failures.join("\n")).toEqual([]);
});
