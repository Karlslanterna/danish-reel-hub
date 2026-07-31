import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.SMOKE_PORT ?? 8080);
const baseURL = process.env.SMOKE_BASE_URL ?? `http://localhost:${PORT}`;
const isExternalTarget = Boolean(process.env.SMOKE_BASE_URL);

export default defineConfig({
  testDir: "./tests/e2e",
  // Smoke tests must be fast and deterministic.
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    // Allows using a system Chromium (set PLAYWRIGHT_CHROMIUM_EXECUTABLE)
    // instead of the bundled download, e.g. in minimal CI images.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // When targeting a deployed URL (SMOKE_BASE_URL) no local server is started.
  webServer: isExternalTarget
    ? undefined
    : {
        command: "bun run dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
