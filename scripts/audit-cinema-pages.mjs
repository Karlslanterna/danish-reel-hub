import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.AUDIT_PORT ?? 8080);
const externalBaseUrl = process.env.AUDIT_BASE_URL?.replace(/\/$/, "");
const baseUrl = externalBaseUrl ?? `http://127.0.0.1:${PORT}`;
const isLocalTarget = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(baseUrl);
const CONCURRENCY = 6;

let server = null;

async function waitForServer() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/robots.txt`);
      if (response.ok) return;
    } catch {
      // The local server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${baseUrl}`);
}

async function fetchText(path, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`${baseUrl}${path}`, { ...init, signal: controller.signal });
    return { response, body: await response.text() };
  } finally {
    clearTimeout(timeout);
  }
}

async function mapLimit(values, limit, run) {
  const results = new Array(values.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await run(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

function pageIssues(path, response, html) {
  const issues = [];
  const visibleTextHtml = html.replace(/<!--.*?-->/gs, "");
  if (response.status !== 200) issues.push(`HTTP ${response.status}`);
  if (!/<h1\b[^>]*>[^<]+<\/h1>/i.test(html)) issues.push("missing h1");
  if (!html.includes('"@type":"MovieTheater"')) issues.push("missing MovieTheater JSON-LD");
  const canonical = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)/i)?.[1];
  const expectedCanonical = `${baseUrl}${path}`;
  if (canonical !== expectedCanonical && canonical !== `https://lanterna.dk${path}`) {
    issues.push(`wrong canonical ${canonical ?? "(missing)"}`);
  }
  if (/href=["'](?:&|\/&|javascript:)/i.test(html)) issues.push("unsafe relative ticket link");
  if (!/film\s+på programmet/i.test(visibleTextHtml)) issues.push("missing full-programme label");
  return issues;
}

try {
  if (!externalBaseUrl) {
    server = spawn(
      fileURLToPath(new URL("../node_modules/.bin/vite", import.meta.url)),
      ["dev", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
      { cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: "ignore" },
    );
  }
  await waitForServer();

  const { response: sitemapResponse, body: sitemap } = await fetchText("/sitemap-cinemas.xml");
  let paths;
  let requireUniquePaths = true;
  if (sitemapResponse.ok) {
    paths = [...sitemap.matchAll(/<loc>https?:\/\/[^/]+(\/biograf\/[^<]+)<\/loc>/g)].map(
      (match) => match[1],
    );
  } else if (isLocalTarget) {
    // Local sitemap generation requires the service-role key, which should not
    // be present in a developer shell. The public index is the safe fallback.
    const { response, body } = await fetchText("/biograf");
    if (!response.ok) throw new Error(`Cinema index returned ${response.status}`);
    paths = [...body.matchAll(/href=["'](\/biograf\/[^"'?]+)["']/g)].map((match) => match[1]);
    requireUniquePaths = false;
  } else {
    throw new Error(`Cinema sitemap returned ${sitemapResponse.status}`);
  }
  const uniquePaths = [...new Set(paths)];
  if (requireUniquePaths && uniquePaths.length !== paths.length)
    throw new Error("Cinema sitemap contains duplicate URLs");
  if (uniquePaths.length === 0) throw new Error("Cinema sitemap contains no cinema URLs");

  const audited = await mapLimit(uniquePaths, CONCURRENCY, async (path) => {
    try {
      const { response, body } = await fetchText(path);
      return { path, issues: pageIssues(path, response, body) };
    } catch (error) {
      return { path, issues: [error instanceof Error ? error.message : String(error)] };
    }
  });
  const failures = audited.filter((result) => result.issues.length > 0);

  const aliasResponse = await fetch(`${baseUrl}/biograf/scala`, { redirect: "manual" });
  const aliasLocation = aliasResponse.headers.get("location");
  if (aliasResponse.status !== 301 || !aliasLocation?.endsWith("/biograf/scala-svendborg")) {
    failures.push({
      path: "/biograf/scala",
      issues: [`expected 301 to Scala Svendborg, got ${aliasResponse.status} ${aliasLocation}`],
    });
  }

  console.log(
    JSON.stringify(
      {
        baseUrl,
        cinemaPages: uniquePaths.length,
        passed: uniquePaths.length - failures.length,
        failed: failures.length,
        failures: failures.slice(0, 50),
      },
      null,
      2,
    ),
  );
  if (failures.length > 0) process.exitCode = 1;
} finally {
  server?.kill("SIGTERM");
}
