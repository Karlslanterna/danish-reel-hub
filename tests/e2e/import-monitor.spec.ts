import { expect, test } from "@playwright/test";

test("strict import monitor is healthy for both current production sources", async ({ request }) => {
  const res = await request.get("/api/public/import-health?monitor=1");
  const raw = await res.text();
  expect(res.status(), `strict import monitor failed: ${raw.slice(0, 500)}`).toBe(200);

  const report = JSON.parse(raw) as {
    monitor?: { status?: string; failures?: string[] };
    sources?: {
      ebillet?: { lastSuccessAt?: string | null; futureScreenings?: number };
      kultunaut?: { lastSuccessAt?: string | null; futureScreenings?: number };
    };
  };
  expect(report.monitor?.status).toBe("healthy");
  expect(report.monitor?.failures ?? []).toEqual([]);
  for (const source of ["ebillet", "kultunaut"] as const) {
    expect(report.sources?.[source]?.lastSuccessAt, `${source} must have a canonical success`).toBeTruthy();
    expect(report.sources?.[source]?.futureScreenings ?? 0, `${source} must have future screenings`).toBeGreaterThan(0);
  }
});
