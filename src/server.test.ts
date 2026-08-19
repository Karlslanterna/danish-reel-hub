import { describe, expect, it } from "vitest";
import { withPublicPageCache } from "./server";

const html = () =>
  new Response("<!doctype html><title>Lanterna</title>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });

describe("public page cache policy", () => {
  it("emits separate browser/shared and CDN cache directives for public HTML", () => {
    const response = withPublicPageCache(html(), new Request("https://lanterna.dk/"));

    expect(response.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=300");
    expect(response.headers.get("cdn-cache-control")).toBe(
      "public, max-age=300, stale-while-revalidate=60",
    );
  });

  it("does not add shared-cache directives to private pages", () => {
    const response = withPublicPageCache(html(), new Request("https://lanterna.dk/auth"));

    expect(response.headers.get("cache-control")).toBeNull();
    expect(response.headers.get("cdn-cache-control")).toBeNull();
  });
});
