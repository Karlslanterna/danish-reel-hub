import { defineConfig, devices } from "@playwright/test";

/**
 * Performance benchmark config — intentionally separate from the functional
 * smoke suite so `npm run test:smoke` stays fast and deterministic and CI is
 * never gated on synthetic timings of an already deployed site.
 */
const PORT = Number(process.env.PERF_PORT ?? process.env.SMOKE_PORT ?? 8080);
const baseURL = process.env.PERF_BASE_URL ?? `http://localhost:${PORT}`;
const isExternalTarget = Boolean(process.env.PERF_BASE_URL);

export default defineConfig({
  testDir: "./tests/performance",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-performance" }]],
  use: {
    ...devices["Pixel 5"],
    baseURL,
    trace: "retain-on-failure",
    video: "off",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  webServer: isExternalTarget
    ? undefined
    : {
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
